import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
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

/** The company mark printed beside the QR on labels (apps/api/assets/forms/logo.png). */
const LOGO_PATH = join(__dirname, '..', '..', 'assets', 'forms', 'logo.png');
/** The box it is fitted into, in points. Any logo keeps its own shape inside it. */
const LOGO_BOX: [number, number] = [46, 22];
let logo: Buffer | null | undefined;
function companyLogo() {
  if (logo === undefined) {
    try {
      logo = readFileSync(LOGO_PATH);
    } catch {
      logo = null; // Labels still print, just without the mark.
    }
  }
  return logo;
}

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
            approvedAt: true,
            employeeId: true,
            // Who is holding it, in enough detail to go and find them.
            employee: {
              select: {
                id: true,
                firstName: true,
                lastName: true,
                employeeNumber: true,
                jobTitle: true,
                email: true,
                phone: true,
                status: true,
                departmentId: true,
                department: { select: { id: true, name: true } },
                location: { select: { id: true, name: true } },
              },
            },
            location: { select: { id: true, name: true } },
            // What went out alongside it, so the label accounts for the whole hand-over.
            accessoryAssignments: {
              where: { status: 'ACTIVE' },
              orderBy: { assignedAt: 'asc' },
              select: {
                id: true,
                quantity: true,
                accessory: { select: { id: true, name: true, code: true } },
                units: { select: { code: true }, orderBy: { number: 'asc' } },
              },
            },
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
        activeAssignment: assignments[0]
          ? { ...assignments[0], departmentId: assignments[0].employee?.departmentId ?? null }
          : null,
        hasOpenMaintenance: maintenance.length > 0,
        auditInProgress: inProgressAudits.length > 0,
      }),
    };
  }

  /** A4 sheet of labels: 3 columns × 8 rows, QR + logo + code + name. */
  async renderLabels(
    items: { code: string; name: string; note?: string | null; qrToken: string }[],
  ): Promise<Buffer> {
    const { companyName } = await this.settings.get();
    const mark = companyLogo();
    const images = await Promise.all(
      items.map((item) =>
        QRCode.toBuffer(this.payloadFor(item.qrToken), { type: 'png', margin: 0, width: 300 }),
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
        items.forEach((item, i) => {
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
          // The mark goes in the gap above the code, which the text alone left empty.
          // `fit` keeps the mark's own shape; left/top is PDFKit's default placement in the box.
          if (mark) doc.image(mark, textX, y + 9, { fit: LOGO_BOX });
          doc
            .font('Helvetica-Bold')
            .fontSize(10)
            .fillColor('#0f172a')
            .text(pdfSafe(item.code), textX, mark ? y + 13 + LOGO_BOX[1] : y + 14, {
              width: textW,
            });
          doc
            .font('Helvetica')
            .fontSize(7.5)
            .fillColor('#334155')
            .text(pdfSafe(item.name), { width: textW, height: mark ? 19 : 30, ellipsis: true });
          if (item.note)
            doc.fontSize(6.5).fillColor('#64748b').text(pdfSafe(item.note), { width: textW });
          doc
            .fontSize(6.5)
            .fillColor('#94a3b8')
            .text(pdfSafe(companyName), textX, y + cellH - 20, { width: textW });
        });
      },
      { margin: 0 },
    );
  }

  /** A4 sheet of asset labels. */
  async labels(assetIds: string[], user: AuthUser) {
    if (!assetIds.length || assetIds.length > 240)
      throw Errors.badRequest('Select between 1 and 240 assets', 'assetIds');
    const assets = await this.prisma.asset.findMany({
      where: { AND: [{ id: { in: assetIds }, deletedAt: null }, this.assets.scopeOrThrow(user)] },
      select: { id: true, assetTag: true, name: true, serialNumber: true, qrToken: true },
      orderBy: { assetTag: 'asc' },
    });
    if (!assets.length) throw Errors.notFound('Assets');
    return this.renderLabels(
      assets.map((a) => ({
        code: a.assetTag,
        name: a.name,
        note: a.serialNumber ? `S/N ${a.serialNumber}` : null,
        qrToken: a.qrToken,
      })),
    );
  }

  /** The QR on its own, for anything that carries a label. */
  async image(qrToken: string, format: 'png' | 'svg', code: string) {
    const payload = this.payloadFor(qrToken);
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
      fileName: `${code}.${format}`,
      contentType: format === 'svg' ? 'image/svg+xml' : 'image/png',
    };
  }

  /** The QR image and payload for anything that carries a label. */
  async codeImage(code: string, qrToken: string) {
    const payload = this.payloadFor(qrToken);
    return {
      code,
      qrToken,
      payload,
      dataUrl: await QRCode.toDataURL(payload, {
        margin: 1,
        width: 360,
        errorCorrectionLevel: 'M',
      }),
    };
  }
}
