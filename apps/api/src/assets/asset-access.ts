import { AssetStatus, Prisma } from '@prisma/client';
import { ASSIGNABLE_STATUSES, canTransition, type AssetAction } from '@itam/shared';
import { can, dataScope, NO_MATCH_ID, type AuthUser } from '../auth/auth-user';

/**
 * Row-level visibility for assets:
 * - all: every asset
 * - department: assets owned by the user's department or currently assigned to someone in it
 * - own: assets currently assigned to the user's employee record
 */
export function assetScopeWhere(user: AuthUser): Prisma.AssetWhereInput | null {
  const scope = dataScope(user, 'asset');
  if (scope === 'all') return {};
  if (scope === 'department') {
    const departmentId = user.departmentId ?? NO_MATCH_ID;
    return {
      OR: [
        { departmentId },
        { assignments: { some: { status: 'ACTIVE', employee: { departmentId } } } },
      ],
    };
  }
  if (scope === 'own') {
    return { assignments: { some: { status: 'ACTIVE', employeeId: user.employeeId ?? NO_MATCH_ID } } };
  }
  return null;
}

export interface AssetActionState {
  status: AssetStatus;
  activeAssignment: { employeeId: string | null; acknowledgedAt: Date | null } | null;
  hasOpenMaintenance: boolean;
  auditInProgress: boolean;
}

/** Actions the user may take on an asset right now — drives buttons in the UI and QR scan results. */
export function allowedAssetActions(user: AuthUser, s: AssetActionState): AssetAction[] {
  const actions: AssetAction[] = ['view'];
  const ownsAssignment = !!user.employeeId && s.activeAssignment?.employeeId === user.employeeId;
  const endOfLife = s.status === 'RETIRED' || s.status === 'DISPOSED';

  if (can(user, 'asset.edit') && s.status !== 'DISPOSED') actions.push('edit');
  if (can(user, 'asset.assign') && ASSIGNABLE_STATUSES.includes(s.status) && !s.activeAssignment) {
    actions.push('assign');
  }
  if (s.activeAssignment && s.status === 'ASSIGNED') {
    if (can(user, 'asset.return')) actions.push('return');
    if (can(user, 'asset.transfer')) actions.push('transfer');
  }
  if (can(user, 'maintenance.create') && !endOfLife && s.status !== 'LOST' && !s.hasOpenMaintenance) {
    actions.push('maintenance');
  }
  if (can(user, 'audit.perform') && s.auditInProgress && s.status !== 'DISPOSED') actions.push('audit');
  if (
    can(user, 'asset.report_lost') &&
    canTransition(s.status, 'LOST') &&
    (dataScope(user, 'asset') === 'all' || ownsAssignment)
  ) {
    actions.push('report_lost');
  }
  if (can(user, 'asset.acknowledge') && ownsAssignment && !s.activeAssignment?.acknowledgedAt) {
    actions.push('acknowledge');
  }
  if (can(user, 'asset.retire') && canTransition(s.status, 'RETIRED') && !s.activeAssignment && !s.hasOpenMaintenance) {
    actions.push('retire');
  }
  if (can(user, 'asset.dispose') && canTransition(s.status, 'DISPOSED')) actions.push('dispose');
  return actions;
}

export const employeeSummarySelect = {
  id: true,
  employeeNumber: true,
  firstName: true,
  lastName: true,
  email: true,
  departmentId: true,
  department: { select: { id: true, name: true } },
} satisfies Prisma.EmployeeSelect;

export const assetSummarySelect = {
  id: true,
  assetTag: true,
  name: true,
  serialNumber: true,
  brand: true,
  model: true,
  status: true,
  condition: true,
  assetType: { select: { id: true, name: true, category: true } },
} satisfies Prisma.AssetSelect;
