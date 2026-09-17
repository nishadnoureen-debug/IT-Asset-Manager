import { AssetCategory, PrismaClient } from '@prisma/client';
import {
  ALL_PERMISSIONS,
  permissionModule,
  ROLE_DETAILS,
  ROLE_PERMISSIONS,
  ROLES,
  type PermissionKey,
  type RoleName,
} from '@itam/shared';

export const DEFAULT_ASSET_TYPES: ReadonlyArray<{
  name: string;
  category: AssetCategory;
  requiresSerial: boolean;
  depreciationMonths?: number;
}> = [
  { name: 'Laptop', category: 'LAPTOP', requiresSerial: true, depreciationMonths: 36 },
  { name: 'Desktop', category: 'DESKTOP', requiresSerial: true, depreciationMonths: 48 },
  { name: 'Monitor', category: 'MONITOR', requiresSerial: true, depreciationMonths: 60 },
  { name: 'Mobile Phone', category: 'MOBILE', requiresSerial: true, depreciationMonths: 24 },
  { name: 'Tablet', category: 'TABLET', requiresSerial: true, depreciationMonths: 36 },
  { name: 'Printer', category: 'PRINTER', requiresSerial: true, depreciationMonths: 60 },
  { name: 'Server', category: 'SERVER', requiresSerial: true, depreciationMonths: 60 },
  {
    name: 'Network Equipment',
    category: 'NETWORK_EQUIPMENT',
    requiresSerial: true,
    depreciationMonths: 60,
  },
  { name: 'Projector', category: 'PROJECTOR', requiresSerial: true, depreciationMonths: 60 },
  { name: 'Accessory', category: 'ACCESSORY', requiresSerial: false },
];

export interface SeedSummary {
  permissions: number;
  newPermissions: number;
  roles: number;
  rolesCreated: number;
  assetTypes: number;
}

/**
 * Idempotent reference-data seed, safe to run on every deploy:
 * - the permission catalogue is synced (unknown keys are removed),
 * - a system role gets its catalogue permissions when it is first created; afterwards only permissions
 *   that are *new to the catalogue* are granted, so admin customisations survive redeploys,
 * - Super Admin always holds every permission,
 * - default asset types are created once and never overwritten.
 */
export async function seedDatabase(prisma: PrismaClient): Promise<SeedSummary> {
  return prisma.$transaction(
    async (tx) => {
      const existingKeys = new Set(
        (await tx.permission.findMany({ select: { key: true } })).map((p) => p.key),
      );
      const newKeys = new Set<PermissionKey>(ALL_PERMISSIONS.filter((k) => !existingKeys.has(k)));

      for (const key of ALL_PERMISSIONS) {
        await tx.permission.upsert({
          where: { key },
          create: { key, module: permissionModule(key) },
          update: { module: permissionModule(key) },
        });
      }
      await tx.permission.deleteMany({ where: { key: { notIn: [...ALL_PERMISSIONS] } } });

      const permissions = await tx.permission.findMany({ select: { id: true, key: true } });
      const idByKey = new Map(permissions.map((p) => [p.key, p.id]));

      let rolesCreated = 0;
      for (const name of Object.keys(ROLE_DETAILS) as RoleName[]) {
        const details = ROLE_DETAILS[name];
        const existing = await tx.role.findUnique({ where: { name } });
        const role = existing
          ? await tx.role.update({ where: { name }, data: { ...details, isSystem: true } })
          : await tx.role.create({ data: { name, ...details, isSystem: true } });
        if (!existing) rolesCreated++;

        const keysToGrant =
          name === ROLES.SUPER_ADMIN
            ? ALL_PERMISSIONS
            : ROLE_PERMISSIONS[name].filter((key) => !existing || newKeys.has(key));

        await tx.rolePermission.createMany({
          data: keysToGrant.map((key) => ({ roleId: role.id, permissionId: idByKey.get(key)! })),
          skipDuplicates: true,
        });
      }

      for (const type of DEFAULT_ASSET_TYPES) {
        await tx.assetType.upsert({ where: { name: type.name }, create: type, update: {} });
      }

      return {
        permissions: permissions.length,
        newPermissions: newKeys.size,
        roles: Object.keys(ROLE_DETAILS).length,
        rolesCreated,
        assetTypes: DEFAULT_ASSET_TYPES.length,
      };
    },
    { timeout: 60_000 },
  );
}

if (require.main === module) {
  const prisma = new PrismaClient();
  seedDatabase(prisma)
    .then((summary) => console.log('Seed complete:', summary))
    .catch((error) => {
      console.error('Seed failed:', error);
      process.exitCode = 1;
    })
    .finally(() => prisma.$disconnect());
}
