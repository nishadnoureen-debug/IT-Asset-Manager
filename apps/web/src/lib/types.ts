import type {
  AssetAction,
  AssetCategory,
  AssetCondition,
  AssetStatus,
  AssignmentStatus,
} from '@itam/shared';

export type Id = string;
export type Decimal = string | number | null;

export interface Ref {
  id: Id;
  name: string;
}
export interface UserRef {
  id: Id;
  displayName: string;
}
export interface EmployeeRef {
  id: Id;
  firstName: string;
  lastName: string;
  employeeNumber?: string;
  email?: string;
  department?: Ref | null;
}

export interface AssetType {
  id: Id;
  name: string;
  category: AssetCategory;
  description: string | null;
  requiresSerial: boolean;
  depreciationMonths: number | null;
  isActive: boolean;
  _count?: { assets: number };
}

export interface AssetListItem {
  id: Id;
  assetTag: string;
  name: string;
  serialNumber: string | null;
  brand: string | null;
  model: string | null;
  status: AssetStatus;
  condition: AssetCondition;
  purchaseDate: string | null;
  purchaseCost: Decimal;
  currency: string | null;
  warrantyEndDate: string | null;
  createdAt: string;
  assetType: { id: Id; name: string; category: AssetCategory };
  location: Ref | null;
  department: Ref | null;
  assignments: { id: Id; assignedAt: string; employee: EmployeeRef | null; location: Ref | null }[];
}

export interface DocumentItem {
  id: Id;
  type: string;
  title: string;
  originalFileName: string;
  mimeType: string;
  sizeBytes: number;
  createdAt: string;
  uploadedBy: UserRef | null;
}

export interface AccessoryAssignment {
  id: Id;
  accessoryId: Id;
  quantity: number;
  status: AssignmentStatus;
  assignedAt: string;
  returnedAt: string | null;
  notes: string | null;
  accessory: { id: Id; name: string; category?: string };
  employee?: EmployeeRef;
}

export interface Assignment {
  id: Id;
  status: AssignmentStatus;
  assignedAt: string;
  expectedReturnAt: string | null;
  returnedAt: string | null;
  acknowledgedAt: string | null;
  conditionAtAssignment: AssetCondition;
  conditionAtReturn: AssetCondition | null;
  transferReason: string | null;
  notes: string | null;
  returnNotes: string | null;
  previousAssignmentId: Id | null;
  employee: EmployeeRef | null;
  location: Ref | null;
  assignedBy: UserRef | null;
  returnedBy?: UserRef | null;
  accessoryAssignments: AccessoryAssignment[];
  documents?: DocumentItem[];
  asset?: { id: Id; assetTag: string; name: string; status: AssetStatus };
}

export interface MaintenanceRecord {
  id: Id;
  number: number;
  assetId: Id;
  type: string;
  status: string;
  priority: string;
  title: string;
  description: string | null;
  isWarrantyClaim: boolean;
  scheduledAt: string | null;
  startedAt: string | null;
  completedAt: string | null;
  cancelledAt: string | null;
  laborCost: Decimal;
  partsCost: Decimal;
  totalCost: Decimal;
  currency: string | null;
  resolutionNotes: string | null;
  createdAt: string;
  technicianId: Id | null;
  vendorId: Id | null;
  asset?: {
    id: Id;
    assetTag: string;
    name: string;
    status: AssetStatus;
    assetType?: { name: string };
  };
  technician?: UserRef | null;
  reportedBy?: UserRef | null;
  vendor?: Ref | null;
  ticket?: { id: Id; number: number; title: string; status: string } | null;
  documents?: DocumentItem[];
}

export interface AssetDetail extends Omit<AssetListItem, 'assignments'> {
  serviceTag: string | null;
  qrToken: string;
  specifications: Record<string, unknown> | null;
  warrantyStartDate: string | null;
  warrantyCoverage: string | null;
  warrantyReference: string | null;
  disposalMethod: string | null;
  disposalReason: string | null;
  retiredAt: string | null;
  disposedAt: string | null;
  lostAt: string | null;
  notes: string | null;
  updatedAt: string;
  locationId: Id | null;
  departmentId: Id | null;
  purchaseId: Id | null;
  vendorId: Id | null;
  warrantyProviderId: Id | null;
  assetTypeId: Id;
  purchase: { id: Id; orderNumber: string | null; invoiceNumber: string | null } | null;
  vendor: Ref | null;
  warrantyProvider: Ref | null;
  createdBy: UserRef | null;
  currentAssignment: Assignment | null;
  openMaintenance: MaintenanceRecord | null;
  allowedActions: AssetAction[];
  _count: { assignments: number; maintenance: number; documents: number };
}

export interface HistoryEntry {
  id: Id;
  action: string;
  fromStatus: AssetStatus | null;
  toStatus: AssetStatus | null;
  description: string | null;
  createdAt: string;
  performedBy: UserRef | null;
  fromLocation?: Ref | null;
  toLocation?: Ref | null;
  asset?: { id: Id; assetTag: string; name: string };
}

export interface Employee {
  id: Id;
  employeeNumber: string;
  firstName: string;
  lastName: string;
  email: string;
  phone: string | null;
  jobTitle: string | null;
  status: 'ACTIVE' | 'ON_LEAVE' | 'TERMINATED';
  hireDate: string | null;
  terminationDate: string | null;
  departmentId: Id | null;
  locationId: Id | null;
  managerId: Id | null;
  department: Ref | null;
  location: Ref | null;
  manager?: { id: Id; firstName: string; lastName: string } | null;
  user: { id: Id; email?: string; status: string; lastLoginAt?: string | null } | null;
  _count: { assignments: number; tickets?: number; accessoryAssignments?: number };
}

export interface Department {
  id: Id;
  code: string;
  name: string;
  description: string | null;
  managerId: Id | null;
  manager: { id: Id; firstName: string; lastName: string } | null;
  _count?: { employees: number; assets: number };
}

export interface Location {
  id: Id;
  code: string;
  name: string;
  type: string;
  parentId: Id | null;
  address: string | null;
  city: string | null;
  country: string | null;
  notes: string | null;
  parent: Ref | null;
  _count?: { assets: number; employees: number };
}

export interface Vendor {
  id: Id;
  name: string;
  types: string[];
  contactName: string | null;
  email: string | null;
  phone: string | null;
  website: string | null;
  address: string | null;
  taxNumber: string | null;
  notes: string | null;
  isActive: boolean;
  _count?: { purchases: number; assets: number; maintenance: number };
}

export interface Purchase {
  id: Id;
  orderNumber: string | null;
  invoiceNumber: string | null;
  vendorId: Id;
  purchaseDate: string;
  invoiceDate: string | null;
  currency: string;
  subtotal: Decimal;
  taxAmount: Decimal;
  totalAmount: Decimal;
  notes: string | null;
  vendor: Ref;
  _count?: { assets: number; accessories: number; softwareLicenses: number; documents: number };
  assets?: {
    id: Id;
    assetTag: string;
    name: string;
    status: AssetStatus;
    purchaseCost: Decimal;
    currency: string | null;
  }[];
  documents?: DocumentItem[];
  createdBy?: UserRef | null;
}

export interface Accessory {
  id: Id;
  name: string;
  category: string;
  sku: string | null;
  brand: string | null;
  model: string | null;
  quantityTotal: number;
  quantityAvailable: number;
  minStockLevel: number;
  unitCost: Decimal;
  currency: string | null;
  notes: string | null;
  locationId: Id | null;
  location: Ref | null;
  assignments?: (AccessoryAssignment & {
    assetAssignment: { id: Id; asset: { id: Id; assetTag: string } } | null;
  })[];
}

export interface Software {
  id: Id;
  name: string;
  version: string | null;
  category: string | null;
  description: string | null;
  isActive: boolean;
  publisher: Ref | null;
  licenseCount?: number;
  totalSeats?: number | null;
  usedSeats?: number;
}

export interface License {
  id: Id;
  softwareId: Id;
  name: string | null;
  licenseType: string;
  seats: number | null;
  allowOverAllocation: boolean;
  purchaseDate: string | null;
  startDate: string | null;
  expiryDate: string | null;
  cost: Decimal;
  currency: string | null;
  notes: string | null;
  software: { id: Id; name: string; version: string | null };
  vendor: Ref | null;
  purchase: { id: Id; orderNumber: string | null } | null;
  licenseKeyMasked: string | null;
  licenseKey?: string | null;
  usedSeats: number;
  availableSeats: number | null;
  utilization: number | null;
  vendorId: Id | null;
  assignments?: {
    id: Id;
    assignedAt: string;
    unassignedAt: string | null;
    notes: string | null;
    asset: { id: Id; assetTag: string; name: string } | null;
    employee: EmployeeRef | null;
    assignedBy: UserRef | null;
  }[];
  documents?: DocumentItem[];
}

export interface Ticket {
  id: Id;
  number: number;
  title: string;
  description: string;
  category: string;
  priority: string;
  status: string;
  dueAt: string | null;
  resolvedAt: string | null;
  closedAt: string | null;
  resolution: string | null;
  createdAt: string;
  updatedAt: string;
  assigneeId: Id | null;
  requester: EmployeeRef | null;
  assignee: UserRef | null;
  asset: { id: Id; assetTag: string; name: string } | null;
  createdBy?: UserRef | null;
  _count?: { comments: number };
  comments?: {
    id: Id;
    body: string;
    isInternal: boolean;
    createdAt: string;
    author: UserRef | null;
  }[];
  maintenance?: { id: Id; number: number; title: string; status: string }[];
  documents?: DocumentItem[];
}

export interface AuditSummary {
  total: number;
  PENDING: number;
  FOUND: number;
  MISSING: number;
  UNEXPECTED: number;
  WRONG_LOCATION: number;
  DAMAGED: number;
}

export interface AuditSession {
  id: Id;
  number: number;
  name: string;
  status: string;
  scheduledAt: string | null;
  startedAt: string | null;
  completedAt: string | null;
  closedAt: string | null;
  notes: string | null;
  createdAt: string;
  locationId: Id | null;
  departmentId: Id | null;
  location: Ref | null;
  department: Ref | null;
  createdBy: UserRef | null;
  completedBy: UserRef | null;
  summary: AuditSummary;
}

export interface AuditItem {
  id: Id;
  expected: boolean;
  result: string;
  scannedCode: string | null;
  observedCondition: AssetCondition | null;
  scannedAt: string | null;
  reviewedAt: string | null;
  resolution: string | null;
  notes: string | null;
  asset: {
    id: Id;
    assetTag: string;
    name: string;
    serialNumber: string | null;
    status: AssetStatus;
    assetType: { name: string };
    location: Ref | null;
  } | null;
  observedLocation: Ref | null;
  expectedLocation: Ref | null;
  scannedBy: UserRef | null;
  reviewedBy: UserRef | null;
}

export interface NotificationItem {
  id: Id;
  type: string;
  title: string;
  message: string;
  link: string | null;
  readAt: string | null;
  createdAt: string;
}

export interface UserAccount {
  id: Id;
  email: string;
  displayName: string;
  status: 'ACTIVE' | 'DISABLED' | 'LOCKED' | 'PENDING';
  lastLoginAt: string | null;
  lockedUntil: string | null;
  createdAt: string;
  employee: {
    id: Id;
    firstName: string;
    lastName: string;
    employeeNumber: string;
    department: { name: string } | null;
  } | null;
  roles: { role: { id: Id; name: string; displayName: string } }[];
}

export interface Role {
  id: Id;
  name: string;
  displayName: string;
  description: string | null;
  isSystem: boolean;
  _count: { users: number; permissions?: number };
  permissionKeys?: string[];
}

export interface Permission {
  id: Id;
  key: string;
  module: string;
  description: string | null;
}

export interface ScanResult {
  asset: {
    id: Id;
    assetTag: string;
    name: string;
    serialNumber: string | null;
    brand: string | null;
    model: string | null;
    status: AssetStatus;
    condition: AssetCondition;
    assetType: { id: Id; name: string; category: AssetCategory };
    location: Ref | null;
    department: Ref | null;
    warrantyEndDate: string | null;
  };
  currentAssignment: {
    id: Id;
    assignedAt: string;
    acknowledgedAt: string | null;
    employee: EmployeeRef | null;
    location: Ref | null;
  } | null;
  openMaintenance: { id: Id; number: number; status: string } | null;
  inProgressAudits: { id: Id; number: number; name: string }[];
  allowedActions: AssetAction[];
}

export interface ActivityLog {
  id: Id;
  action: string;
  entityType: string;
  entityId: string | null;
  oldValues: unknown;
  newValues: unknown;
  ipAddress: string | null;
  userAgent: string | null;
  requestId: string | null;
  createdAt: string;
  actor: { id: Id; email: string; displayName: string } | null;
}

export interface ReportColumn {
  key: string;
  label: string;
  type?: 'text' | 'number' | 'money' | 'date' | 'datetime';
}

export interface ReportResult {
  type: string;
  title: string;
  columns: ReportColumn[];
  rows: Record<string, string | number | boolean | null>[];
  total: number;
  truncated: boolean;
  generatedAt: string;
}

/** `GET /auth/registration`: whether the sign-in page offers registration, and if it needs approval. */
export interface RegistrationOptions {
  enabled: boolean;
  requiresApproval: boolean;
}
