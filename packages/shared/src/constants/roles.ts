/** The six system roles (spec §4). */
export const ROLES = {
  SUPER_ADMIN: 'SUPER_ADMIN',
  IT_ADMINISTRATOR: 'IT_ADMINISTRATOR',
  IT_TECHNICIAN: 'IT_TECHNICIAN',
  DEPARTMENT_MANAGER: 'DEPARTMENT_MANAGER',
  EMPLOYEE: 'EMPLOYEE',
  AUDITOR: 'AUDITOR',
} as const;
export type RoleName = (typeof ROLES)[keyof typeof ROLES];

export const ROLE_DETAILS: Record<RoleName, { displayName: string; description: string }> = {
  SUPER_ADMIN: {
    displayName: 'Super Admin',
    description: 'Full access including users, roles, permissions, settings and audit logs.',
  },
  IT_ADMINISTRATOR: {
    displayName: 'IT Administrator',
    description:
      'Full operational asset management, employees, assignments, maintenance, reports and users.',
  },
  IT_TECHNICIAN: {
    displayName: 'IT Technician',
    description: 'Assets, assignments/returns, QR, maintenance, asset requests and audits.',
  },
  DEPARTMENT_MANAGER: {
    displayName: 'Department Manager',
    description: 'Assets and employees within own department and configured approvals.',
  },
  EMPLOYEE: {
    displayName: 'Employee',
    description: 'Own profile and assets, acknowledgements, loss reports and own asset requests.',
  },
  AUDITOR: {
    displayName: 'Auditor',
    description: 'Read-only inventory plus audit execution and audit reports.',
  },
};
