/**
 * Asset lifecycle (spec §1):
 * Purchased → Registered → In Stock → Assigned → Transferred/Returned → Repair → Available → Retired → Disposed.
 * Values mirror the Prisma enums (a DB test keeps them in sync).
 */
export const ASSET_STATUSES = [
  'PURCHASED',
  'REGISTERED',
  'IN_STOCK',
  'ASSIGNED',
  'IN_REPAIR',
  'AVAILABLE',
  'LOST',
  'RETIRED',
  'DISPOSED',
] as const;
export type AssetStatus = (typeof ASSET_STATUSES)[number];

export const ASSET_CATEGORIES = [
  'LAPTOP',
  'DESKTOP',
  'MONITOR',
  'MOBILE',
  'TABLET',
  'PRINTER',
  'SERVER',
  'NETWORK_EQUIPMENT',
  'PROJECTOR',
  'ACCESSORY',
] as const;
export type AssetCategory = (typeof ASSET_CATEGORIES)[number];

export const ASSET_CONDITIONS = ['NEW', 'GOOD', 'FAIR', 'POOR', 'DAMAGED'] as const;
export type AssetCondition = (typeof ASSET_CONDITIONS)[number];

export const ASSIGNMENT_STATUSES = ['ACTIVE', 'RETURNED', 'TRANSFERRED'] as const;
export type AssignmentStatus = (typeof ASSIGNMENT_STATUSES)[number];

/**
 * Allowed status transitions. ASSIGNED → ASSIGNED is a transfer; IN_REPAIR → ASSIGNED restores an asset
 * that was repaired while still assigned.
 */
export const ASSET_TRANSITIONS: Record<AssetStatus, readonly AssetStatus[]> = {
  PURCHASED: ['REGISTERED', 'IN_STOCK', 'RETIRED'],
  REGISTERED: ['IN_STOCK', 'RETIRED'],
  IN_STOCK: ['ASSIGNED', 'IN_REPAIR', 'AVAILABLE', 'LOST', 'RETIRED'],
  AVAILABLE: ['ASSIGNED', 'IN_REPAIR', 'IN_STOCK', 'LOST', 'RETIRED'],
  ASSIGNED: ['ASSIGNED', 'IN_STOCK', 'IN_REPAIR', 'LOST'],
  IN_REPAIR: ['AVAILABLE', 'ASSIGNED', 'IN_STOCK', 'LOST', 'RETIRED'],
  LOST: ['IN_STOCK', 'RETIRED', 'DISPOSED'],
  RETIRED: ['DISPOSED'],
  DISPOSED: [],
};

export function canTransition(from: AssetStatus, to: AssetStatus): boolean {
  return ASSET_TRANSITIONS[from].includes(to);
}

/** Statuses from which an asset can be handed to an employee/location. */
export const ASSIGNABLE_STATUSES: readonly AssetStatus[] = ['IN_STOCK', 'AVAILABLE'];

/** Statuses set by explicit lifecycle actions only (never via a plain edit). */
export const WORKFLOW_ONLY_STATUSES: readonly AssetStatus[] = [
  'ASSIGNED',
  'IN_REPAIR',
  'LOST',
  'RETIRED',
  'DISPOSED',
];

/** Actions returned with an asset (and by QR scan) according to role and state. */
export const ASSET_ACTIONS = [
  'view',
  'edit',
  'assign',
  'return',
  'transfer',
  'maintenance',
  'audit',
  'report_lost',
  'acknowledge',
  'retire',
  'dispose',
] as const;
export type AssetAction = (typeof ASSET_ACTIONS)[number];
