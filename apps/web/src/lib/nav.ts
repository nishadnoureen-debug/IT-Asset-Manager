import type { PermissionKey } from '@itam/shared';
import {
  BarChart3,
  Boxes,
  ClipboardCheck,
  FileClock,
  KeyRound,
  LayoutDashboard,
  Laptop,
  type LucideIcon,
  QrCode,
  Settings,
  ShieldCheck,
  ShoppingCart,
  Users,
  UserCog,
  Wrench,
} from 'lucide-react';

export interface NavItem {
  href: string;
  label: string;
  icon: LucideIcon;
  /** Shown when the user holds any of these permissions. */
  anyOf: PermissionKey[];
  section: 'main' | 'operations' | 'admin';
}

export const NAV: NavItem[] = [
  {
    href: '/dashboard',
    label: 'Dashboard',
    icon: LayoutDashboard,
    anyOf: ['dashboard.view'],
    section: 'main',
  },
  { href: '/scan', label: 'Scan QR', icon: QrCode, anyOf: ['qr.scan'], section: 'main' },
  {
    href: '/assets',
    label: 'Assets',
    icon: Laptop,
    anyOf: ['asset.view', 'asset.view_department', 'asset.view_own'],
    section: 'main',
  },
  {
    href: '/employees',
    label: 'Employees',
    icon: Users,
    anyOf: ['employee.view', 'employee.view_department'],
    section: 'main',
  },
  {
    href: '/requests',
    label: 'Asset requests',
    icon: ClipboardCheck,
    anyOf: ['request.view', 'request.view_department', 'request.view_own'],
    section: 'main',
  },
  {
    href: '/accessories',
    label: 'Accessories',
    icon: Boxes,
    anyOf: ['accessory.view', 'accessory.manage'],
    section: 'operations',
  },
  {
    href: '/maintenance',
    label: 'Maintenance',
    icon: Wrench,
    anyOf: ['maintenance.view'],
    section: 'operations',
  },
  {
    href: '/warranty',
    label: 'Warranty',
    icon: ShieldCheck,
    anyOf: ['warranty.view', 'warranty.edit'],
    section: 'operations',
  },
  {
    href: '/software',
    label: 'Software & licences',
    icon: KeyRound,
    anyOf: ['software.view', 'license.view'],
    section: 'operations',
  },
  {
    href: '/purchases',
    label: 'Purchases & vendors',
    icon: ShoppingCart,
    anyOf: ['purchase.view', 'vendor.view'],
    section: 'operations',
  },
  {
    href: '/audits',
    label: 'Inventory audits',
    icon: ClipboardCheck,
    anyOf: ['audit.view'],
    section: 'operations',
  },
  {
    href: '/reports',
    label: 'Reports',
    icon: BarChart3,
    anyOf: ['report.view', 'report.export'],
    section: 'operations',
  },
  {
    href: '/users',
    label: 'Users & roles',
    icon: UserCog,
    anyOf: ['user.view', 'role.view'],
    section: 'admin',
  },
  {
    href: '/activity-logs',
    label: 'Activity log',
    icon: FileClock,
    anyOf: ['activity_log.view'],
    section: 'admin',
  },
  {
    href: '/settings',
    label: 'Settings',
    icon: Settings,
    anyOf: ['settings.view', 'department.manage', 'location.manage', 'asset_type.manage'],
    section: 'admin',
  },
];

export const SECTION_LABELS: Record<NavItem['section'], string> = {
  main: 'Workspace',
  operations: 'Operations',
  admin: 'Administration',
};
