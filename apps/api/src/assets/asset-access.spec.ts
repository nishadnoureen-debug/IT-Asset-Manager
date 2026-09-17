import { ASSET_STATUSES, canTransition, ROLE_PERMISSIONS, type RoleName } from '@itam/shared';
import type { AuthUser } from '../auth/auth-user';
import { allowedAssetActions, assetScopeWhere } from './asset-access';

function user(role: RoleName, overrides: Partial<AuthUser> = {}): AuthUser {
  return {
    id: 'u1',
    email: 'x@example.com',
    displayName: 'X',
    employeeId: 'e1',
    departmentId: 'd1',
    roles: [role],
    permissions: new Set(ROLE_PERMISSIONS[role]),
    ...overrides,
  };
}

const idle = { activeAssignment: null, hasOpenMaintenance: false, auditInProgress: false };

describe('lifecycle transitions', () => {
  it('never allows leaving DISPOSED', () => {
    for (const s of ASSET_STATUSES) expect(canTransition('DISPOSED', s)).toBe(false);
  });

  it('follows the spec path Purchased → … → Disposed', () => {
    const path = ['PURCHASED', 'REGISTERED', 'IN_STOCK', 'ASSIGNED', 'IN_REPAIR', 'AVAILABLE', 'RETIRED', 'DISPOSED'] as const;
    for (let i = 0; i < path.length - 1; i++) expect(canTransition(path[i], path[i + 1])).toBe(true);
  });

  it('requires retiring before disposal of a normal asset', () => {
    expect(canTransition('IN_STOCK', 'DISPOSED')).toBe(false);
    expect(canTransition('ASSIGNED', 'RETIRED')).toBe(false);
  });
});

describe('allowedAssetActions', () => {
  it('lets technicians assign stock but not retire it', () => {
    const actions = allowedAssetActions(user('IT_TECHNICIAN'), { status: 'IN_STOCK', ...idle });
    expect(actions).toEqual(expect.arrayContaining(['view', 'edit', 'assign', 'maintenance']));
    expect(actions).not.toContain('retire');
    expect(actions).not.toContain('return');
  });

  it('offers return/transfer only for assigned assets', () => {
    const actions = allowedAssetActions(user('IT_ADMINISTRATOR'), {
      ...idle,
      status: 'ASSIGNED',
      activeAssignment: { employeeId: 'e9', acknowledgedAt: null },
    });
    expect(actions).toEqual(expect.arrayContaining(['return', 'transfer', 'report_lost']));
    expect(actions).not.toContain('assign');
    expect(actions).not.toContain('retire');
    expect(actions).not.toContain('acknowledge');
  });

  it('lets employees acknowledge and report only their own assignment', () => {
    const own = allowedAssetActions(user('EMPLOYEE'), {
      ...idle,
      status: 'ASSIGNED',
      activeAssignment: { employeeId: 'e1', acknowledgedAt: null },
    });
    expect(own.sort()).toEqual(['acknowledge', 'report_lost', 'view']);

    const someoneElse = allowedAssetActions(user('EMPLOYEE'), {
      ...idle,
      status: 'ASSIGNED',
      activeAssignment: { employeeId: 'e2', acknowledgedAt: null },
    });
    expect(someoneElse).toEqual(['view']);
  });

  it('offers audit scanning only while an audit is running', () => {
    expect(allowedAssetActions(user('AUDITOR'), { status: 'IN_STOCK', ...idle })).toEqual(['view']);
    expect(allowedAssetActions(user('AUDITOR'), { status: 'IN_STOCK', ...idle, auditInProgress: true })).toEqual(['view', 'audit']);
  });

  it('blocks maintenance when one is already open or the asset is gone', () => {
    const tech = user('IT_TECHNICIAN');
    expect(allowedAssetActions(tech, { status: 'IN_STOCK', ...idle, hasOpenMaintenance: true })).not.toContain('maintenance');
    expect(allowedAssetActions(tech, { status: 'LOST', ...idle })).not.toContain('maintenance');
  });
});

describe('assetScopeWhere', () => {
  it('returns no filter for full access and null without any view permission', () => {
    expect(assetScopeWhere(user('IT_TECHNICIAN'))).toEqual({});
    expect(assetScopeWhere(user('EMPLOYEE', { permissions: new Set() }))).toBeNull();
  });

  it('never matches everything for scoped users without an employee link', () => {
    const scope = assetScopeWhere(user('EMPLOYEE', { employeeId: null }));
    expect(JSON.stringify(scope)).toContain('00000000-0000-0000-0000-000000000000');
  });
});
