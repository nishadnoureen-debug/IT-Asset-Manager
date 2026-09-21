import type { PermissionKey } from '@itam/shared';

/** The authenticated principal attached to each request by JwtAuthGuard. */
export interface AuthUser {
  id: string;
  email: string;
  displayName: string;
  employeeId: string | null;
  departmentId: string | null;
  roles: string[];
  permissions: ReadonlySet<string>;
}

export function can(user: AuthUser, ...anyOf: PermissionKey[]): boolean {
  return anyOf.some((key) => user.permissions.has(key));
}

export type DataScope = 'all' | 'department' | 'own';

/**
 * Resolve the widest data scope a user holds for a resource, from `x.view` / `x.view_department` /
 * `x.view_own` permissions. Returns null when the user cannot see the resource at all.
 */
export function dataScope(
  user: AuthUser,
  resource: 'asset' | 'employee' | 'ticket',
): DataScope | null {
  if (user.permissions.has(`${resource}.view`)) return 'all';
  if (user.permissions.has(`${resource}.view_department`)) return 'department';
  if (user.permissions.has(`${resource}.view_own`)) return 'own';
  return null;
}

/** Sentinel UUID that matches no row — used when a scoped user lacks an employee/department link. */
export const NO_MATCH_ID = '00000000-0000-0000-0000-000000000000';
