import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { Errors } from '../common/errors';
import { PrismaService } from '../prisma/prisma.service';

/** The pieces of an accessory, in the order they are handed out. */
const BY_NUMBER = { number: 'asc' } satisfies Prisma.AccessoryUnitOrderByWithRelationInput;

export const unitSelect = {
  id: true,
  code: true,
  number: true,
  status: true,
  serialNumber: true,
  qrToken: true,
  assignmentId: true,
} satisfies Prisma.AccessoryUnitSelect;

/**
 * Accessories are counted in stock, and every piece of that stock is a unit with its own code and
 * QR label. Stock numbers and units are changed together, so the count always matches the pieces.
 */
@Injectable()
export class AccessoryUnitsService {
  constructor(private readonly prisma: PrismaService) {}

  /** Adds `count` pieces, numbered on from the last one. */
  async add(
    tx: Prisma.TransactionClient,
    accessoryId: string,
    count: number,
  ): Promise<{ code: string }[]> {
    if (count < 1) return [];
    const accessory = await tx.accessory.findUniqueOrThrow({
      where: { id: accessoryId },
      select: { code: true },
    });
    const last = await tx.accessoryUnit.findFirst({
      where: { accessoryId },
      orderBy: { number: 'desc' },
      select: { number: true },
    });
    const from = (last?.number ?? 0) + 1;
    const units = Array.from({ length: count }, (_, i) => ({
      accessoryId,
      number: from + i,
      code: `${accessory.code}-${String(from + i).padStart(2, '0')}`,
    }));
    await tx.accessoryUnit.createMany({ data: units });
    return units.map((u) => ({ code: u.code }));
  }

  /**
   * Hands `count` pieces to an assignment: the ones asked for first, then whatever else is in the
   * store, oldest number first.
   */
  async take(
    tx: Prisma.TransactionClient,
    accessoryId: string,
    count: number,
    assignmentId: string,
    preferred: string[] = [],
  ): Promise<void> {
    if (count < 1) return;
    await this.topUp(tx, accessoryId);
    const free = await tx.accessoryUnit.findMany({
      where: { accessoryId, status: 'IN_STOCK' },
      orderBy: BY_NUMBER,
      select: { id: true },
    });
    const wanted = preferred.filter((id) => free.some((u) => u.id === id));
    if (preferred.length && wanted.length !== preferred.length)
      throw Errors.invalidState('One of the pieces you chose is no longer in the store');
    const ids = [...wanted, ...free.filter((u) => !wanted.includes(u.id)).map((u) => u.id)].slice(
      0,
      count,
    );
    if (ids.length < count)
      throw Errors.invalidState('There are not enough pieces of this accessory in the store');
    await tx.accessoryUnit.updateMany({
      where: { id: { in: ids } },
      data: { status: 'ASSIGNED', assignmentId },
    });
  }

  /**
   * Gives an accessory the pieces its stock says it has. Stock written in before pieces existed —
   * an import, or a row made outside the API — is labelled the first time it is handed out.
   */
  private async topUp(tx: Prisma.TransactionClient, accessoryId: string): Promise<void> {
    const accessory = await tx.accessory.findUniqueOrThrow({
      where: { id: accessoryId },
      select: { quantityTotal: true },
    });
    const have = await tx.accessoryUnit.count({
      where: { accessoryId, status: { not: 'RETIRED' } },
    });
    await this.add(tx, accessoryId, accessory.quantityTotal - have);
  }

  /** Takes the pieces of an assignment back: into the store, or written off as damaged. */
  async release(
    tx: Prisma.TransactionClient,
    assignmentId: string,
    damaged = false,
  ): Promise<void> {
    await tx.accessoryUnit.updateMany({
      where: { assignmentId },
      data: { status: damaged ? 'DAMAGED' : 'IN_STOCK', assignmentId: null },
    });
  }

  /** Retires `count` pieces that are still in the store, newest number first. */
  async retire(tx: Prisma.TransactionClient, accessoryId: string, count: number): Promise<void> {
    if (count < 1) return;
    const spare = await tx.accessoryUnit.findMany({
      where: { accessoryId, status: 'IN_STOCK' },
      orderBy: { number: 'desc' },
      take: count,
      select: { id: true },
    });
    if (spare.length < count)
      throw Errors.invalidState('Those pieces are with someone and cannot be removed');
    await tx.accessoryUnit.updateMany({
      where: { id: { in: spare.map((u) => u.id) } },
      data: { status: 'RETIRED' },
    });
  }

  /** The pieces of an accessory, with who is holding each one. */
  list(accessoryId: string) {
    return this.prisma.accessoryUnit.findMany({
      where: { accessoryId, status: { not: 'RETIRED' } },
      orderBy: BY_NUMBER,
      select: {
        ...unitSelect,
        assignment: {
          select: {
            id: true,
            assignedAt: true,
            employee: {
              select: { id: true, firstName: true, lastName: true, employeeNumber: true },
            },
            assetAssignment: { select: { asset: { select: { id: true, assetTag: true } } } },
          },
        },
      },
    });
  }

  /** The codes of the pieces handed over with one assignment, for the printed form. */
  async codesFor(assignmentIds: string[]): Promise<Map<string, string[]>> {
    const units = await this.prisma.accessoryUnit.findMany({
      where: { assignmentId: { in: assignmentIds } },
      orderBy: BY_NUMBER,
      select: { code: true, assignmentId: true },
    });
    const byAssignment = new Map<string, string[]>();
    for (const unit of units)
      byAssignment.set(unit.assignmentId!, [
        ...(byAssignment.get(unit.assignmentId!) ?? []),
        unit.code,
      ]);
    return byAssignment;
  }
}
