import { randomUUID } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Prisma } from '@prisma/client';
import QRCode from 'qrcode';
import { ActivityLogService } from '../activity-logs/activity-log.service';
import { allowedAssetActions, assetSummarySelect } from '../assets/asset-access';
import { AssetHistoryService } from '../assets/asset-history.service';
import { AssetsService, OPEN_MAINTENANCE } from '../assets/assets.service';
import { can, type AuthUser } from '../auth/auth-user';
import { Errors } from '../common/errors';
import type { Env } from '../config/env.validation';
import { PdfService, pdfSafe } from '../pdf/pdf.service';
import { PrismaService } from '../prisma/prisma.service';
import { SettingsService } from '../settings/settings.service';

const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;

/** Extract the lookup value from a scanned payload: a label URL, a bare QR token, an asset tag or a serial. */
export function parseScannedCode(raw: string): { token?: string; text: string } {
  const text = raw.trim();
  const url = /\/qr\/([0-9a-f-]{36})(?:[/?#]|$)/i.exec(text);
  if (url) return { token: url[1].toLowerCase(), text };
  if (UUID.test(text) && text.length === 36) return { token: text.toLowerCase(), text };
  return { text };
}

@Injectable()
export class QrService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly assets: AssetsService,
    private readonly history: AssetHistoryService,
    private readonly activity: ActivityLogService,
    private readonly pdf: PdfService,
    private readonly settings: SettingsService,
    private readonly config: ConfigService<Env, true>,
  ) {}

  payloadFor(qrToken: string): string {
    return `${this.config.get('PUBLIC_WEB_URL', { infer: true })}/qr/${qrToken}`;
  }

  async get(id: string, user: AuthUser) {
    const asset = await this.assets.findVisible(id, user);
    const payload = this.payloadFor(asset.qrToken);
    return {
      assetId: asset.id,
      assetTag: asset.assetTag,
      qrToken: asset.qrToken,
      payload,
      dataUrl: await QRCode.toDataURL(payload, {
        margin: 1,
        width: 360,
        errorCorrectionLevel: 'M',
      }),
    };
  }

  async download(id: string, format: 'png' | 'svg', user: AuthUser) {
    const asset = await this.assets.findVisible(id, user);
    const payload = this.payloadFor(asset.qrToken);
    const body =
      format === 'svg'
        ? Buffer.from(
            await QRCode.toString(payload, { type: 'svg', margin: 1, errorCorrectionLevel: 'M' }),
          )
        : await QRCode.toBuffer(payload, {
            type: 'png',
            margin: 1,
            width: 600,
            errorCorrectionLevel: 'M',
          });
    return {
      body,
      fileName: `${asset.assetTag}.${format}`,
      contentType: format === 'svg' ? 'image/svg+xml' : 'image/png',
    };
  }

  async regenerate(id: string, user: AuthUser) {
    const asset = await this.assets.findVisible(id, user);
    const qrToken = randomUUID();
    await this.prisma.$transaction(async (tx) => {
      await tx.asset.update({ where: { id }, data: { qrToken, updatedById: user.id } });
      await this.history.record(tx, {
        assetId: id,
        action: 'QR_REGENERATED',
        performedById: user.id,
        description: 'Previous QR labels are no longer valid',
      });
      await this.activity.record(
        { actorId: user.id, action: 'qr.regenerate', entityType: 'asset', entityId: id },
        tx,
      );
    });
    return this.get(asset.id, user);
  }

  /** Resolve a scanned code to an asset the user can see, with the actions allowed right now. */
  async scan(code: string, user: AuthUser) {
    const { token, text } = parseScannedCode(code);
    const match: Prisma.AssetWhereInput = token
      ? { qrToken: token }
      : {
          OR: [
            { assetTag: { equals: text, mode: 'insensitive' } },
            { serialNumber: { equals: text, mode: 'insensitive' } },
          ],
        };
    const asset = await this.prisma.asset.findFirst({
      where: { AND: [match, { deletedAt: null }, this.assets.scopeOrThrow(user)] },
      select: {
        ...assetSummarySelect,
        location: { select: { id: true, name: true } },
        department: { select: { id: true, name: true } },
        warrantyEndDate: true,
        assignments: {
          where: { status: 'ACTIVE' },
          take: 1,
          select: {
            id: true,
            assignedAt: true,
            acknowledgedAt: true,
            employeeId: true,
            employee: {
              select: { id: true, firstName: true, lastName: true, employeeNumber: true },
            },
            location: { select: { id: true, name: true } },
          },
        },
        maintenance: {
          where: OPEN_MAINTENANCE,
          take: 1,
          select: { id: true, number: true, status: true },
        },
      },
    });
    if (!asset) throw Errors.notFound('No asset matches this code');

    const inProgressAudits = can(user, 'audit.perform')
      ? await this.prisma.auditSession.findMany({
          where: { status: 'IN_PROGRESS' },
          select: { id: true, number: true, name: true },
          orderBy: { startedAt: 'desc' },
        })
      : [];
    const { assignments, maintenance, ...rest } = asset;
    return {
      asset: rest,
      currentAssignment: assignments[0] ?? null,
      openMaintenance: maintenance[0] ?? null,
      inProgressAudits,
      allowedActions: allowedAssetActions(user, {
        status: asset.status,
        activeAssignment: assignments[0] ?? null,
        hasOpenMaintenance: maintenance.length > 0,
        auditInProgress: inProgressAudits.length > 0,
      }),
    };
  }

  /** A4 sheet of labels: 3 columns × 8 rows, QR + asset tag + name. */
  async labels(assetIds: string[], user: AuthUser) {
    if (!assetIds.length || assetIds.length > 240)
      throw Errors.badRequest('Select between 1 and 240 assets', 'assetIds');
    const assets = await this.prisma.asset.findMany({
      where: { AND: [{ id: { in: assetIds }, deletedAt: null }, this.assets.scopeOrThrow(user)] },
      select: { id: true, assetTag: true, name: true, serialNumber: true, qrToken: true },
      orderBy: { assetTag: 'asc' },
    });
    if (!assets.length) throw Errors.notFound('Assets');
    const { companyName } = await this.settings.get();
    const images = await Promise.all(
      assets.map((a) =>
        QRCode.toBuffer(this.payloadFor(a.qrToken), { type: 'png', margin: 0, width: 300 }),
      ),
    );
    return this.pdf.render(
      (doc) => {
        const cols = 3;
        const rows = 8;
        const marginX = 24;
        const marginY = 30;
        const cellW = (doc.page.width - marginX * 2) / cols;
        const cellH = (doc.page.height - marginY * 2) / rows;
        assets.forEach((asset, i) => {
          if (i > 0 && i % (cols * rows) === 0) doc.addPage();
          const index = i % (cols * rows);
          const x = marginX + (index % cols) * cellW;
          const y = marginY + Math.floor(index / cols) * cellH;
          const qr = cellH - 16;
          doc
            .rect(x + 2, y + 2, cellW - 4, cellH - 4)
            .lineWidth(0.3)
            .strokeColor('#cbd5e1')
            .stroke();
          doc.image(images[i], x + 8, y + 8, { width: qr - 8, height: qr - 8 });
          const textX = x + qr + 6;
          const textW = cellW - qr - 14;
          doc
            .font('Helvetica-Bold')
            .fontSize(10)
            .fillColor('#0f172a')
            .text(pdfSafe(asset.assetTag), textX, y + 14, { width: textW });
          doc
            .font('Helvetica')
            .fontSize(7.5)
            .fillColor('#334155')
            .text(pdfSafe(asset.name), { width: textW, height: 30, ellipsis: true });
          if (asset.serialNumber)
            doc
              .fontSize(6.5)
              .fillColor('#64748b')
              .text(`S/N ${pdfSafe(asset.serialNumber)}`, { width: textW });
          doc
            .fontSize(6.5)
            .fillColor('#94a3b8')
            .text(pdfSafe(companyName), textX, y + cellH - 20, { width: textW });
        });
      },
      { margin: 0 },
    );
  }
}
