import { ROLES, type RoleName } from './roles';

/**
 * Granular permission catalogue (spec §4). Seeded into `permissions` and mapped to the six system
 * roles below. The backend is the enforcement point; the frontend only uses these to hide UI.
 *
 * Data scope is part of the key where the spec requires it:
 *   `*.view` = all records, `*.view_department` = own department, `*.view_own` = own records.
 */
export const PERMISSIONS = {
  DASHBOARD_VIEW: 'dashboard.view',

  ASSET_VIEW: 'asset.view',
  ASSET_VIEW_DEPARTMENT: 'asset.view_department',
  ASSET_VIEW_OWN: 'asset.view_own',
  ASSET_CREATE: 'asset.create',
  ASSET_EDIT: 'asset.edit',
  ASSET_DELETE: 'asset.delete',
  ASSET_ASSIGN: 'asset.assign',
  ASSET_RETURN: 'asset.return',
  ASSET_TRANSFER: 'asset.transfer',
  ASSET_ACKNOWLEDGE: 'asset.acknowledge',
  ASSET_REPORT_LOST: 'asset.report_lost',
  ASSET_RETIRE: 'asset.retire',
  ASSET_DISPOSE: 'asset.dispose',
  ASSET_TYPE_MANAGE: 'asset_type.manage',

  EMPLOYEE_VIEW: 'employee.view',
  EMPLOYEE_VIEW_DEPARTMENT: 'employee.view_department',
  EMPLOYEE_VIEW_OWN: 'employee.view_own',
  EMPLOYEE_CREATE: 'employee.create',
  EMPLOYEE_EDIT: 'employee.edit',
  EMPLOYEE_DELETE: 'employee.delete',

  DEPARTMENT_VIEW: 'department.view',
  DEPARTMENT_MANAGE: 'department.manage',
  LOCATION_VIEW: 'location.view',
  LOCATION_MANAGE: 'location.manage',

  ACCESSORY_VIEW: 'accessory.view',
  ACCESSORY_MANAGE: 'accessory.manage',
  ACCESSORY_ASSIGN: 'accessory.assign',

  QR_GENERATE: 'qr.generate',
  QR_SCAN: 'qr.scan',

  MAINTENANCE_VIEW: 'maintenance.view',
  MAINTENANCE_CREATE: 'maintenance.create',
  MAINTENANCE_EDIT: 'maintenance.edit',
  MAINTENANCE_COMPLETE: 'maintenance.complete',

  WARRANTY_VIEW: 'warranty.view',
  WARRANTY_EDIT: 'warranty.edit',

  VENDOR_VIEW: 'vendor.view',
  VENDOR_MANAGE: 'vendor.manage',
  PURCHASE_VIEW: 'purchase.view',
  PURCHASE_MANAGE: 'purchase.manage',

  SOFTWARE_VIEW: 'software.view',
  SOFTWARE_MANAGE: 'software.manage',
  LICENSE_VIEW: 'license.view',
  LICENSE_MANAGE: 'license.manage',
  LICENSE_ASSIGN: 'license.assign',

  REQUEST_VIEW: 'request.view',
  REQUEST_VIEW_DEPARTMENT: 'request.view_department',
  REQUEST_VIEW_OWN: 'request.view_own',
  REQUEST_CREATE: 'request.create',
  REQUEST_EDIT: 'request.edit',
  REQUEST_APPROVE: 'request.approve',
  REQUEST_FULFIL: 'request.fulfil',
  REQUEST_CANCEL: 'request.cancel',

  SIM_VIEW: 'sim.view',
  SIM_MANAGE: 'sim.manage',

  AUDIT_VIEW: 'audit.view',
  AUDIT_CREATE: 'audit.create',
  AUDIT_PERFORM: 'audit.perform',
  AUDIT_REVIEW: 'audit.review',

  REPORT_VIEW: 'report.view',
  REPORT_EXPORT: 'report.export',

  DOCUMENT_VIEW: 'document.view',
  DOCUMENT_UPLOAD: 'document.upload',
  DOCUMENT_DELETE: 'document.delete',

  NOTIFICATION_VIEW: 'notification.view',

  USER_VIEW: 'user.view',
  USER_CREATE: 'user.create',
  USER_EDIT: 'user.edit',
  USER_DISABLE: 'user.disable',
  ROLE_VIEW: 'role.view',
  ROLE_MANAGE: 'role.manage',

  SETTINGS_VIEW: 'settings.view',
  SETTINGS_EDIT: 'settings.edit',
  ACTIVITY_LOG_VIEW: 'activity_log.view',
} as const;
export type PermissionKey = (typeof PERMISSIONS)[keyof typeof PERMISSIONS];

export const ALL_PERMISSIONS: readonly PermissionKey[] = Object.values(PERMISSIONS);

/** Module = the part before the first dot, e.g. `asset.assign` → `asset`. */
export function permissionModule(key: PermissionKey): string {
  return key.split('.')[0];
}

const P = PERMISSIONS;

/**
 * Operational permissions for IT Administrators: everything except role/permission management,
 * settings changes and the security activity log (Super Admin only, spec §4).
 */
const SUPER_ADMIN_ONLY: readonly PermissionKey[] = [
  P.ROLE_MANAGE,
  P.SETTINGS_EDIT,
  P.ACTIVITY_LOG_VIEW,
];

export const ROLE_PERMISSIONS: Record<RoleName, readonly PermissionKey[]> = {
  [ROLES.SUPER_ADMIN]: ALL_PERMISSIONS,

  [ROLES.IT_ADMINISTRATOR]: ALL_PERMISSIONS.filter((key) => !SUPER_ADMIN_ONLY.includes(key)),

  // Assets, assignments/returns, QR, maintenance, asset requests and audits.
  [ROLES.IT_TECHNICIAN]: [
    P.DASHBOARD_VIEW,
    P.ASSET_VIEW,
    P.ASSET_CREATE,
    P.ASSET_EDIT,
    P.ASSET_ASSIGN,
    P.ASSET_RETURN,
    P.ASSET_TRANSFER,
    P.ASSET_REPORT_LOST,
    P.EMPLOYEE_VIEW,
    P.DEPARTMENT_VIEW,
    P.LOCATION_VIEW,
    P.ACCESSORY_VIEW,
    P.ACCESSORY_ASSIGN,
    P.QR_GENERATE,
    P.QR_SCAN,
    P.MAINTENANCE_VIEW,
    P.MAINTENANCE_CREATE,
    P.MAINTENANCE_EDIT,
    P.MAINTENANCE_COMPLETE,
    P.WARRANTY_VIEW,
    P.VENDOR_VIEW,
    P.SOFTWARE_VIEW,
    P.LICENSE_VIEW,
    P.LICENSE_ASSIGN,
    P.REQUEST_VIEW,
    P.REQUEST_CREATE,
    P.REQUEST_EDIT,
    P.REQUEST_FULFIL,
    P.AUDIT_VIEW,
    P.AUDIT_PERFORM,
    P.SIM_VIEW,
    P.DOCUMENT_VIEW,
    P.DOCUMENT_UPLOAD,
    P.NOTIFICATION_VIEW,
  ],

  // Assets/employees within own department. Approval permissions are added when approvals are configured.
  [ROLES.DEPARTMENT_MANAGER]: [
    P.DASHBOARD_VIEW,
    P.ASSET_VIEW_DEPARTMENT,
    P.EMPLOYEE_VIEW_DEPARTMENT,
    P.DEPARTMENT_VIEW,
    P.LOCATION_VIEW,
    P.REQUEST_VIEW_DEPARTMENT,
    P.REQUEST_CREATE,
    P.REQUEST_APPROVE,
    P.REPORT_VIEW,
    P.DOCUMENT_VIEW,
    P.NOTIFICATION_VIEW,
  ],

  // Own profile/assets, acknowledgements, issue/loss reports and own tickets.
  [ROLES.EMPLOYEE]: [
    P.DASHBOARD_VIEW,
    P.ASSET_VIEW_OWN,
    P.ASSET_ACKNOWLEDGE,
    P.ASSET_REPORT_LOST,
    P.EMPLOYEE_VIEW_OWN,
    P.REQUEST_VIEW_OWN,
    P.REQUEST_CREATE,
    P.NOTIFICATION_VIEW,
  ],

  // Read-only inventory plus audit execution and audit reports.
  [ROLES.AUDITOR]: [
    P.DASHBOARD_VIEW,
    P.ASSET_VIEW,
    P.DEPARTMENT_VIEW,
    P.LOCATION_VIEW,
    P.ACCESSORY_VIEW,
    P.QR_SCAN,
    P.WARRANTY_VIEW,
    P.VENDOR_VIEW,
    P.PURCHASE_VIEW,
    P.SOFTWARE_VIEW,
    P.LICENSE_VIEW,
    P.AUDIT_VIEW,
    P.AUDIT_CREATE,
    P.AUDIT_PERFORM,
    P.SIM_VIEW,
    P.REQUEST_VIEW,
    P.REPORT_VIEW,
    P.REPORT_EXPORT,
    P.DOCUMENT_VIEW,
    P.NOTIFICATION_VIEW,
  ],
};
