import { createHash, randomUUID } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { DocumentType, Prisma } from '@prisma/client';
import { ActivityLogService, type Db } from '../activity-logs/activity-log.service';
import { AssetHistoryService } from '../assets/asset-history.service';
import { can, type AuthUser } from '../auth/auth-user';
import { Errors } from '../common/errors';
import { PrismaService } from '../prisma/prisma.service';
import { StorageService } from '../storage/storage.service';
import { ALLOWED_UPLOAD_TYPES, detectMime, safeFileName } from './file-validation';

export type DocumentOwner = Partial<
  Pick<
    Prisma.DocumentUncheckedCreateInput,
    | 'assetId'
    | 'assignmentId'
    | 'maintenanceId'
    | 'purchaseId'
    | 'softwareLicenseId'
    | 'ticketId'
    | 'auditSessionId'
    | 'employeeId'
  >
>;

export const OWNER_FIELDS = [
  'assetId',
  'assignmentId',
  'maintenanceId',
  'purchaseId',
  'softwareLicenseId',
  'ticketId',
  'auditSessionId',
  'employeeId',
] as const;

export const documentSelect = {
  id: true,
  type: true,
  title: true,
  originalFileName: true,
  mimeType: true,
  sizeBytes: true,
  createdAt: true,
  assetId: true,
  assignmentId: true,
  maintenanceId: true,
  purchaseId: true,
  softwareLicenseId: true,
  ticketId: true,
  auditSessionId: true,
  employeeId: true,
  uploadedBy: { select: { id: true, displayName: true } },
} satisfies Prisma.DocumentSelect;

@Injectable()
export class DocumentsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
    private readonly activity: ActivityLogService,
    private readonly history: AssetHistoryService,
  ) {}

  /** Validate and store a user upload. */
  async upload(
    file: { buffer: Buffer; originalname: string; size: number },
    meta: { type: DocumentType; title?: string } & DocumentOwner,
    user: AuthUser,
  ) {
    const mimeType = detectMime(file.buffer);
    if (!mimeType) {
      throw Errors.badRequest(`Unsupported file type. Allowed: PDF, PNG, JPEG, WebP`, 'file');
    }
    const owners = OWNER_FIELDS.filter((f) => meta[f]);
    if (owners.length === 0) throw Errors.badRequest('Attach the document to a record', 'assetId');
    await this.assertOwnersExist(meta);

    const originalFileName = safeFileName(file.originalname);
    return this.prisma.$transaction(async (tx) => {
      const doc = await this.store(
        tx,
        {
          buffer: file.buffer,
          mimeType,
          type: meta.type,
          title: meta.title?.trim() || originalFileName,
          originalFileName,
          owner: Object.fromEntries(owners.map((f) => [f, meta[f]])) as DocumentOwner,
        },
        user.id,
      );
      await this.activity.record(
        {
          actorId: user.id,
          action: 'document.upload',
          entityType: 'document',
          entityId: doc.id,
          newValues: { type: doc.type, title: doc.title, ...doc.owner },
        },
        tx,
      );
      return doc.record;
    });
  }

  /**
   * Persist a (validated or server-generated) file and its metadata. The object is written before the
   * row so a failed upload never leaves a dangling row; an orphaned object is harmless.
   */
  async store(
    db: Db,
    input: {
      buffer: Buffer;
      mimeType: string;
      type: DocumentType;
      title: string;
      originalFileName: string;
      owner: DocumentOwner;
    },
    uploadedById: string | null,
  ) {
    const ext = ALLOWED_UPLOAD_TYPES[input.mimeType as keyof typeof ALLOWED_UPLOAD_TYPES] ?? 'bin';
    const now = new Date();
    const storageKey = `documents/${now.getUTCFullYear()}/${String(now.getUTCMonth() + 1).padStart(2, '0')}/${randomUUID()}.${ext}`;
    await this.storage.put(storageKey, input.buffer, input.mimeType);
    const record = await db.document.create({
      data: {
        type: input.type,
        title: input.title.slice(0, 200),
        originalFileName: input.originalFileName.slice(0, 255),
        mimeType: input.mimeType,
        sizeBytes: input.buffer.length,
        storageKey,
        checksumSha256: createHash('sha256').update(input.buffer).digest('hex'),
        uploadedById,
        ...input.owner,
      },
      select: documentSelect,
    });
    if (input.owner.assetId) {
      await this.history.record(db, {
        assetId: input.owner.assetId,
        action: 'DOCUMENT_ADDED',
        performedById: uploadedById,
        description: `${input.type}: ${record.title}`,
        metadata: { documentId: record.id },
      });
    }
    return { id: record.id, type: record.type, title: record.title, owner: input.owner, record };
  }

  async list(owner: DocumentOwner, user: AuthUser) {
    const where: Prisma.DocumentWhereInput = { deletedAt: null, ...owner };
    if (!OWNER_FIELDS.some((f) => owner[f]))
      throw Errors.badRequest('Specify the record to list documents for');
    if (!can(user, 'document.view')) Object.assign(where, this.ownDocumentsFilter(user));
    return this.prisma.document.findMany({
      where,
      select: documentSelect,
      orderBy: { createdAt: 'desc' },
    });
  }

  async download(id: string, user: AuthUser) {
    const where: Prisma.DocumentWhereInput = { id, deletedAt: null };
    if (!can(user, 'document.view')) Object.assign(where, this.ownDocumentsFilter(user));
    const doc = await this.prisma.document.findFirst({ where });
    if (!doc) throw Errors.notFound('Document');
    const body = await this.storage.get(doc.storageKey);
    return { doc, body };
  }

  async remove(id: string, user: AuthUser) {
    const doc = await this.prisma.document.findFirst({ where: { id, deletedAt: null } });
    if (!doc) throw Errors.notFound('Document');
    if (doc.type === 'HANDOVER_FORM' || doc.type === 'RETURN_FORM' || doc.type === 'SIGNATURE') {
      throw Errors.invalidState(
        'Handover/return forms and signatures are part of the audit trail and cannot be deleted',
      );
    }
    await this.prisma.$transaction(async (tx) => {
      await tx.document.update({ where: { id }, data: { deletedAt: new Date() } });
      await this.activity.record(
        {
          actorId: user.id,
          action: 'document.delete',
          entityType: 'document',
          entityId: id,
          oldValues: { title: doc.title, type: doc.type },
        },
        tx,
      );
    });
    return { id, deleted: true };
  }

  /** Users without document.view only see documents about themselves or their own assignments. */
  private ownDocumentsFilter(user: AuthUser): Prisma.DocumentWhereInput {
    if (!user.employeeId) return { id: '00000000-0000-0000-0000-000000000000' };
    return {
      OR: [
        { employeeId: user.employeeId },
        { assignment: { employeeId: user.employeeId } },
        { ticket: { requesterId: user.employeeId } },
      ],
    };
  }

  private async assertOwnersExist(owner: DocumentOwner): Promise<void> {
    const checks: [string, Promise<unknown>][] = [];
    if (owner.assetId)
      checks.push([
        'Asset',
        this.prisma.asset.findFirst({ where: { id: owner.assetId, deletedAt: null } }),
      ]);
    if (owner.assignmentId)
      checks.push([
        'Assignment',
        this.prisma.assetAssignment.findUnique({ where: { id: owner.assignmentId } }),
      ]);
    if (owner.maintenanceId)
      checks.push([
        'Maintenance record',
        this.prisma.maintenance.findUnique({ where: { id: owner.maintenanceId } }),
      ]);
    if (owner.purchaseId)
      checks.push([
        'Purchase',
        this.prisma.purchase.findFirst({ where: { id: owner.purchaseId, deletedAt: null } }),
      ]);
    if (owner.softwareLicenseId)
      checks.push([
        'License',
        this.prisma.softwareLicense.findFirst({
          where: { id: owner.softwareLicenseId, deletedAt: null },
        }),
      ]);
    if (owner.ticketId)
      checks.push(['Ticket', this.prisma.ticket.findUnique({ where: { id: owner.ticketId } })]);
    if (owner.auditSessionId)
      checks.push([
        'Audit',
        this.prisma.auditSession.findUnique({ where: { id: owner.auditSessionId } }),
      ]);
    if (owner.employeeId)
      checks.push([
        'Employee',
        this.prisma.employee.findFirst({ where: { id: owner.employeeId, deletedAt: null } }),
      ]);
    for (const [name, promise] of checks) {
      if (!(await promise)) throw Errors.notFound(name);
    }
  }
}
