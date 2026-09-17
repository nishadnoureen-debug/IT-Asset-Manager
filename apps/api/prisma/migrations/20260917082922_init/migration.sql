-- CreateEnum
CREATE TYPE "asset_status" AS ENUM ('PURCHASED', 'REGISTERED', 'IN_STOCK', 'ASSIGNED', 'IN_REPAIR', 'AVAILABLE', 'LOST', 'RETIRED', 'DISPOSED');

-- CreateEnum
CREATE TYPE "asset_category" AS ENUM ('LAPTOP', 'DESKTOP', 'MONITOR', 'MOBILE', 'TABLET', 'PRINTER', 'SERVER', 'NETWORK_EQUIPMENT', 'PROJECTOR', 'ACCESSORY');

-- CreateEnum
CREATE TYPE "asset_condition" AS ENUM ('NEW', 'GOOD', 'FAIR', 'POOR', 'DAMAGED');

-- CreateEnum
CREATE TYPE "assignment_status" AS ENUM ('ACTIVE', 'RETURNED', 'TRANSFERRED');

-- CreateEnum
CREATE TYPE "asset_history_action" AS ENUM ('CREATED', 'UPDATED', 'STATUS_CHANGED', 'LOCATION_CHANGED', 'ASSIGNED', 'RETURNED', 'TRANSFERRED', 'MAINTENANCE_STARTED', 'MAINTENANCE_COMPLETED', 'WARRANTY_UPDATED', 'QR_REGENERATED', 'DOCUMENT_ADDED', 'SOFTWARE_ASSIGNED', 'SOFTWARE_UNASSIGNED', 'AUDITED', 'REPORTED_LOST', 'RETIRED', 'DISPOSED');

-- CreateEnum
CREATE TYPE "employee_status" AS ENUM ('ACTIVE', 'ON_LEAVE', 'TERMINATED');

-- CreateEnum
CREATE TYPE "location_type" AS ENUM ('SITE', 'BUILDING', 'FLOOR', 'ROOM', 'WAREHOUSE', 'DATA_CENTER', 'REMOTE', 'OTHER');

-- CreateEnum
CREATE TYPE "vendor_type" AS ENUM ('SUPPLIER', 'MANUFACTURER', 'SERVICE_PROVIDER', 'WARRANTY_PROVIDER', 'SOFTWARE_PUBLISHER');

-- CreateEnum
CREATE TYPE "accessory_category" AS ENUM ('CHARGER', 'MOUSE', 'KEYBOARD', 'BAG', 'DOCKING_STATION', 'HEADSET', 'CABLE', 'ADAPTER', 'OTHER');

-- CreateEnum
CREATE TYPE "maintenance_type" AS ENUM ('REPAIR', 'PREVENTIVE', 'UPGRADE', 'INSPECTION');

-- CreateEnum
CREATE TYPE "maintenance_status" AS ENUM ('SCHEDULED', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "priority" AS ENUM ('LOW', 'MEDIUM', 'HIGH', 'CRITICAL');

-- CreateEnum
CREATE TYPE "license_type" AS ENUM ('PERPETUAL', 'SUBSCRIPTION', 'VOLUME', 'OEM', 'OPEN_SOURCE', 'TRIAL');

-- CreateEnum
CREATE TYPE "ticket_category" AS ENUM ('HARDWARE', 'SOFTWARE', 'NETWORK', 'ACCESS', 'ASSET_REQUEST', 'LOSS_REPORT', 'OTHER');

-- CreateEnum
CREATE TYPE "ticket_status" AS ENUM ('OPEN', 'IN_PROGRESS', 'ON_HOLD', 'RESOLVED', 'CLOSED');

-- CreateEnum
CREATE TYPE "document_type" AS ENUM ('INVOICE', 'WARRANTY', 'HANDOVER_FORM', 'RETURN_FORM', 'SIGNATURE', 'REPAIR_RECEIPT', 'DISPOSAL_CERTIFICATE', 'PHOTO', 'LICENSE_CERTIFICATE', 'AUDIT_REPORT', 'OTHER');

-- CreateEnum
CREATE TYPE "audit_session_status" AS ENUM ('DRAFT', 'IN_PROGRESS', 'IN_REVIEW', 'CLOSED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "audit_item_result" AS ENUM ('PENDING', 'FOUND', 'MISSING', 'UNEXPECTED', 'WRONG_LOCATION', 'DAMAGED');

-- CreateEnum
CREATE TYPE "user_status" AS ENUM ('ACTIVE', 'DISABLED', 'LOCKED');

-- CreateEnum
CREATE TYPE "notification_type" AS ENUM ('WARRANTY_EXPIRING', 'LICENSE_EXPIRING', 'OVERDUE_RETURN', 'MAINTENANCE_DUE', 'MAINTENANCE_UPDATE', 'TICKET_UPDATE', 'AUDIT_ASSIGNED', 'ASSIGNMENT_ACKNOWLEDGEMENT', 'SYSTEM');

-- CreateTable
CREATE TABLE "departments" (
    "id" UUID NOT NULL,
    "code" VARCHAR(32) NOT NULL,
    "name" VARCHAR(120) NOT NULL,
    "description" TEXT,
    "manager_id" UUID,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    "deleted_at" TIMESTAMPTZ(6),

    CONSTRAINT "departments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "locations" (
    "id" UUID NOT NULL,
    "code" VARCHAR(32) NOT NULL,
    "name" VARCHAR(120) NOT NULL,
    "type" "location_type" NOT NULL DEFAULT 'OTHER',
    "parent_id" UUID,
    "address" TEXT,
    "city" VARCHAR(120),
    "country" VARCHAR(120),
    "notes" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    "deleted_at" TIMESTAMPTZ(6),

    CONSTRAINT "locations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "employees" (
    "id" UUID NOT NULL,
    "employee_number" VARCHAR(32) NOT NULL,
    "first_name" VARCHAR(80) NOT NULL,
    "last_name" VARCHAR(80) NOT NULL,
    "email" VARCHAR(254) NOT NULL,
    "phone" VARCHAR(40),
    "job_title" VARCHAR(120),
    "department_id" UUID,
    "location_id" UUID,
    "manager_id" UUID,
    "status" "employee_status" NOT NULL DEFAULT 'ACTIVE',
    "hire_date" DATE,
    "termination_date" DATE,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    "deleted_at" TIMESTAMPTZ(6),

    CONSTRAINT "employees_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "vendors" (
    "id" UUID NOT NULL,
    "name" VARCHAR(160) NOT NULL,
    "types" "vendor_type"[],
    "contact_name" VARCHAR(120),
    "email" VARCHAR(254),
    "phone" VARCHAR(40),
    "website" VARCHAR(255),
    "address" TEXT,
    "tax_number" VARCHAR(64),
    "notes" TEXT,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    "deleted_at" TIMESTAMPTZ(6),

    CONSTRAINT "vendors_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "purchases" (
    "id" UUID NOT NULL,
    "order_number" VARCHAR(64),
    "invoice_number" VARCHAR(64),
    "vendor_id" UUID NOT NULL,
    "purchase_date" DATE NOT NULL,
    "invoice_date" DATE,
    "currency" CHAR(3) NOT NULL DEFAULT 'USD',
    "subtotal" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "tax_amount" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "total_amount" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "notes" TEXT,
    "created_by_id" UUID,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    "deleted_at" TIMESTAMPTZ(6),

    CONSTRAINT "purchases_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "asset_types" (
    "id" UUID NOT NULL,
    "name" VARCHAR(80) NOT NULL,
    "category" "asset_category" NOT NULL,
    "description" TEXT,
    "requires_serial" BOOLEAN NOT NULL DEFAULT true,
    "depreciation_months" INTEGER,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "asset_types_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "assets" (
    "id" UUID NOT NULL,
    "asset_tag" VARCHAR(32) NOT NULL,
    "serial_number" VARCHAR(128),
    "service_tag" VARCHAR(128),
    "qr_token" UUID NOT NULL,
    "name" VARCHAR(160) NOT NULL,
    "asset_type_id" UUID NOT NULL,
    "brand" VARCHAR(80),
    "model" VARCHAR(120),
    "specifications" JSONB,
    "status" "asset_status" NOT NULL DEFAULT 'REGISTERED',
    "condition" "asset_condition" NOT NULL DEFAULT 'NEW',
    "location_id" UUID,
    "department_id" UUID,
    "purchase_id" UUID,
    "vendor_id" UUID,
    "purchase_date" DATE,
    "purchase_cost" DECIMAL(14,2),
    "currency" CHAR(3),
    "warranty_provider_id" UUID,
    "warranty_start_date" DATE,
    "warranty_end_date" DATE,
    "warranty_coverage" TEXT,
    "warranty_reference" VARCHAR(128),
    "lost_at" TIMESTAMPTZ(6),
    "retired_at" TIMESTAMPTZ(6),
    "disposed_at" TIMESTAMPTZ(6),
    "disposal_method" VARCHAR(80),
    "disposal_reason" TEXT,
    "notes" TEXT,
    "created_by_id" UUID,
    "updated_by_id" UUID,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    "deleted_at" TIMESTAMPTZ(6),

    CONSTRAINT "assets_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "asset_assignments" (
    "id" UUID NOT NULL,
    "asset_id" UUID NOT NULL,
    "employee_id" UUID,
    "location_id" UUID,
    "status" "assignment_status" NOT NULL DEFAULT 'ACTIVE',
    "assigned_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expected_return_at" TIMESTAMPTZ(6),
    "returned_at" TIMESTAMPTZ(6),
    "assigned_by_id" UUID,
    "returned_by_id" UUID,
    "condition_at_assignment" "asset_condition" NOT NULL,
    "condition_at_return" "asset_condition",
    "acknowledged_at" TIMESTAMPTZ(6),
    "previous_assignment_id" UUID,
    "transfer_reason" TEXT,
    "notes" TEXT,
    "return_notes" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "asset_assignments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "asset_history" (
    "id" UUID NOT NULL,
    "asset_id" UUID NOT NULL,
    "action" "asset_history_action" NOT NULL,
    "from_status" "asset_status",
    "to_status" "asset_status",
    "from_location_id" UUID,
    "to_location_id" UUID,
    "assignment_id" UUID,
    "maintenance_id" UUID,
    "performed_by_id" UUID,
    "description" TEXT,
    "metadata" JSONB,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "asset_history_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "accessories" (
    "id" UUID NOT NULL,
    "name" VARCHAR(160) NOT NULL,
    "category" "accessory_category" NOT NULL,
    "sku" VARCHAR(64),
    "brand" VARCHAR(80),
    "model" VARCHAR(120),
    "quantity_total" INTEGER NOT NULL DEFAULT 0,
    "quantity_available" INTEGER NOT NULL DEFAULT 0,
    "min_stock_level" INTEGER NOT NULL DEFAULT 0,
    "location_id" UUID,
    "purchase_id" UUID,
    "unit_cost" DECIMAL(14,2),
    "currency" CHAR(3),
    "notes" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    "deleted_at" TIMESTAMPTZ(6),

    CONSTRAINT "accessories_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "accessory_assignments" (
    "id" UUID NOT NULL,
    "accessory_id" UUID NOT NULL,
    "employee_id" UUID NOT NULL,
    "asset_assignment_id" UUID,
    "quantity" INTEGER NOT NULL DEFAULT 1,
    "status" "assignment_status" NOT NULL DEFAULT 'ACTIVE',
    "assigned_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "returned_at" TIMESTAMPTZ(6),
    "assigned_by_id" UUID,
    "returned_by_id" UUID,
    "condition_at_assignment" "asset_condition",
    "condition_at_return" "asset_condition",
    "notes" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "accessory_assignments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "maintenance" (
    "id" UUID NOT NULL,
    "number" SERIAL NOT NULL,
    "asset_id" UUID NOT NULL,
    "type" "maintenance_type" NOT NULL DEFAULT 'REPAIR',
    "status" "maintenance_status" NOT NULL DEFAULT 'SCHEDULED',
    "priority" "priority" NOT NULL DEFAULT 'MEDIUM',
    "title" VARCHAR(200) NOT NULL,
    "description" TEXT,
    "reported_by_id" UUID,
    "technician_id" UUID,
    "vendor_id" UUID,
    "ticket_id" UUID,
    "is_warranty_claim" BOOLEAN NOT NULL DEFAULT false,
    "asset_status_before" "asset_status",
    "scheduled_at" TIMESTAMPTZ(6),
    "started_at" TIMESTAMPTZ(6),
    "completed_at" TIMESTAMPTZ(6),
    "cancelled_at" TIMESTAMPTZ(6),
    "labor_cost" DECIMAL(14,2),
    "parts_cost" DECIMAL(14,2),
    "total_cost" DECIMAL(14,2),
    "currency" CHAR(3),
    "resolution_notes" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "maintenance_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "software" (
    "id" UUID NOT NULL,
    "name" VARCHAR(160) NOT NULL,
    "version" VARCHAR(64),
    "publisher_id" UUID,
    "category" VARCHAR(80),
    "description" TEXT,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    "deleted_at" TIMESTAMPTZ(6),

    CONSTRAINT "software_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "software_licenses" (
    "id" UUID NOT NULL,
    "software_id" UUID NOT NULL,
    "name" VARCHAR(160),
    "license_type" "license_type" NOT NULL,
    "license_key_encrypted" TEXT,
    "seats" INTEGER,
    "allow_over_allocation" BOOLEAN NOT NULL DEFAULT false,
    "purchase_id" UUID,
    "vendor_id" UUID,
    "purchase_date" DATE,
    "start_date" DATE,
    "expiry_date" DATE,
    "cost" DECIMAL(14,2),
    "currency" CHAR(3),
    "notes" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    "deleted_at" TIMESTAMPTZ(6),

    CONSTRAINT "software_licenses_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "software_assignments" (
    "id" UUID NOT NULL,
    "license_id" UUID NOT NULL,
    "asset_id" UUID,
    "employee_id" UUID,
    "assigned_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "unassigned_at" TIMESTAMPTZ(6),
    "assigned_by_id" UUID,
    "unassigned_by_id" UUID,
    "notes" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "software_assignments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tickets" (
    "id" UUID NOT NULL,
    "number" SERIAL NOT NULL,
    "title" VARCHAR(200) NOT NULL,
    "description" TEXT NOT NULL,
    "category" "ticket_category" NOT NULL DEFAULT 'OTHER',
    "priority" "priority" NOT NULL DEFAULT 'MEDIUM',
    "status" "ticket_status" NOT NULL DEFAULT 'OPEN',
    "requester_id" UUID,
    "created_by_id" UUID,
    "assignee_id" UUID,
    "asset_id" UUID,
    "due_at" TIMESTAMPTZ(6),
    "resolved_at" TIMESTAMPTZ(6),
    "closed_at" TIMESTAMPTZ(6),
    "resolution" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "tickets_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ticket_comments" (
    "id" UUID NOT NULL,
    "ticket_id" UUID NOT NULL,
    "author_id" UUID,
    "body" TEXT NOT NULL,
    "is_internal" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "ticket_comments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "documents" (
    "id" UUID NOT NULL,
    "type" "document_type" NOT NULL,
    "title" VARCHAR(200) NOT NULL,
    "original_file_name" VARCHAR(255) NOT NULL,
    "mime_type" VARCHAR(127) NOT NULL,
    "size_bytes" INTEGER NOT NULL,
    "storage_key" VARCHAR(512) NOT NULL,
    "checksum_sha256" CHAR(64),
    "asset_id" UUID,
    "assignment_id" UUID,
    "maintenance_id" UUID,
    "purchase_id" UUID,
    "software_license_id" UUID,
    "ticket_id" UUID,
    "audit_session_id" UUID,
    "employee_id" UUID,
    "uploaded_by_id" UUID,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deleted_at" TIMESTAMPTZ(6),

    CONSTRAINT "documents_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "audit_sessions" (
    "id" UUID NOT NULL,
    "number" SERIAL NOT NULL,
    "name" VARCHAR(160) NOT NULL,
    "status" "audit_session_status" NOT NULL DEFAULT 'DRAFT',
    "location_id" UUID,
    "department_id" UUID,
    "scheduled_at" TIMESTAMPTZ(6),
    "started_at" TIMESTAMPTZ(6),
    "completed_at" TIMESTAMPTZ(6),
    "closed_at" TIMESTAMPTZ(6),
    "created_by_id" UUID,
    "completed_by_id" UUID,
    "notes" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "audit_sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "audit_items" (
    "id" UUID NOT NULL,
    "audit_session_id" UUID NOT NULL,
    "asset_id" UUID,
    "scanned_code" VARCHAR(128),
    "expected" BOOLEAN NOT NULL DEFAULT true,
    "result" "audit_item_result" NOT NULL DEFAULT 'PENDING',
    "expected_location_id" UUID,
    "observed_location_id" UUID,
    "observed_condition" "asset_condition",
    "scanned_at" TIMESTAMPTZ(6),
    "scanned_by_id" UUID,
    "reviewed_at" TIMESTAMPTZ(6),
    "reviewed_by_id" UUID,
    "resolution" TEXT,
    "notes" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "audit_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "users" (
    "id" UUID NOT NULL,
    "email" VARCHAR(254) NOT NULL,
    "password_hash" TEXT,
    "display_name" VARCHAR(160) NOT NULL,
    "employee_id" UUID,
    "status" "user_status" NOT NULL DEFAULT 'ACTIVE',
    "failed_login_attempts" INTEGER NOT NULL DEFAULT 0,
    "locked_until" TIMESTAMPTZ(6),
    "last_login_at" TIMESTAMPTZ(6),
    "password_changed_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    "deleted_at" TIMESTAMPTZ(6),

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "roles" (
    "id" UUID NOT NULL,
    "name" VARCHAR(64) NOT NULL,
    "display_name" VARCHAR(120) NOT NULL,
    "description" TEXT,
    "is_system" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "roles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "permissions" (
    "id" UUID NOT NULL,
    "key" VARCHAR(100) NOT NULL,
    "module" VARCHAR(64) NOT NULL,
    "description" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "permissions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "user_roles" (
    "user_id" UUID NOT NULL,
    "role_id" UUID NOT NULL,
    "assigned_by_id" UUID,
    "assigned_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "user_roles_pkey" PRIMARY KEY ("user_id","role_id")
);

-- CreateTable
CREATE TABLE "role_permissions" (
    "role_id" UUID NOT NULL,
    "permission_id" UUID NOT NULL,
    "granted_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "role_permissions_pkey" PRIMARY KEY ("role_id","permission_id")
);

-- CreateTable
CREATE TABLE "notifications" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "type" "notification_type" NOT NULL,
    "title" VARCHAR(200) NOT NULL,
    "message" TEXT NOT NULL,
    "entity_type" VARCHAR(64),
    "entity_id" UUID,
    "link" VARCHAR(512),
    "read_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "notifications_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "activity_logs" (
    "id" UUID NOT NULL,
    "actor_id" UUID,
    "action" VARCHAR(100) NOT NULL,
    "entity_type" VARCHAR(64) NOT NULL,
    "entity_id" VARCHAR(64),
    "old_values" JSONB,
    "new_values" JSONB,
    "ip_address" VARCHAR(45),
    "user_agent" VARCHAR(512),
    "request_id" VARCHAR(128),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "activity_logs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "departments_code_key" ON "departments"("code");

-- CreateIndex
CREATE INDEX "departments_manager_id_idx" ON "departments"("manager_id");

-- CreateIndex
CREATE INDEX "departments_name_idx" ON "departments"("name");

-- CreateIndex
CREATE UNIQUE INDEX "locations_code_key" ON "locations"("code");

-- CreateIndex
CREATE INDEX "locations_parent_id_idx" ON "locations"("parent_id");

-- CreateIndex
CREATE INDEX "locations_name_idx" ON "locations"("name");

-- CreateIndex
CREATE UNIQUE INDEX "employees_employee_number_key" ON "employees"("employee_number");

-- CreateIndex
CREATE UNIQUE INDEX "employees_email_key" ON "employees"("email");

-- CreateIndex
CREATE INDEX "employees_department_id_idx" ON "employees"("department_id");

-- CreateIndex
CREATE INDEX "employees_location_id_idx" ON "employees"("location_id");

-- CreateIndex
CREATE INDEX "employees_manager_id_idx" ON "employees"("manager_id");

-- CreateIndex
CREATE INDEX "employees_status_idx" ON "employees"("status");

-- CreateIndex
CREATE INDEX "employees_last_name_first_name_idx" ON "employees"("last_name", "first_name");

-- CreateIndex
CREATE UNIQUE INDEX "vendors_name_key" ON "vendors"("name");

-- CreateIndex
CREATE UNIQUE INDEX "purchases_order_number_key" ON "purchases"("order_number");

-- CreateIndex
CREATE INDEX "purchases_purchase_date_idx" ON "purchases"("purchase_date");

-- CreateIndex
CREATE UNIQUE INDEX "purchases_vendor_id_invoice_number_key" ON "purchases"("vendor_id", "invoice_number");

-- CreateIndex
CREATE UNIQUE INDEX "asset_types_name_key" ON "asset_types"("name");

-- CreateIndex
CREATE INDEX "asset_types_category_idx" ON "asset_types"("category");

-- CreateIndex
CREATE UNIQUE INDEX "assets_asset_tag_key" ON "assets"("asset_tag");

-- CreateIndex
CREATE UNIQUE INDEX "assets_serial_number_key" ON "assets"("serial_number");

-- CreateIndex
CREATE UNIQUE INDEX "assets_qr_token_key" ON "assets"("qr_token");

-- CreateIndex
CREATE INDEX "assets_status_idx" ON "assets"("status");

-- CreateIndex
CREATE INDEX "assets_asset_type_id_idx" ON "assets"("asset_type_id");

-- CreateIndex
CREATE INDEX "assets_location_id_idx" ON "assets"("location_id");

-- CreateIndex
CREATE INDEX "assets_department_id_idx" ON "assets"("department_id");

-- CreateIndex
CREATE INDEX "assets_purchase_id_idx" ON "assets"("purchase_id");

-- CreateIndex
CREATE INDEX "assets_vendor_id_idx" ON "assets"("vendor_id");

-- CreateIndex
CREATE INDEX "assets_warranty_end_date_idx" ON "assets"("warranty_end_date");

-- CreateIndex
CREATE INDEX "assets_status_location_id_idx" ON "assets"("status", "location_id");

-- CreateIndex
CREATE UNIQUE INDEX "asset_assignments_previous_assignment_id_key" ON "asset_assignments"("previous_assignment_id");

-- CreateIndex
CREATE INDEX "asset_assignments_asset_id_assigned_at_idx" ON "asset_assignments"("asset_id", "assigned_at" DESC);

-- CreateIndex
CREATE INDEX "asset_assignments_employee_id_status_idx" ON "asset_assignments"("employee_id", "status");

-- CreateIndex
CREATE INDEX "asset_assignments_location_id_idx" ON "asset_assignments"("location_id");

-- CreateIndex
CREATE INDEX "asset_assignments_status_idx" ON "asset_assignments"("status");

-- CreateIndex
CREATE INDEX "asset_history_asset_id_created_at_idx" ON "asset_history"("asset_id", "created_at" DESC);

-- CreateIndex
CREATE INDEX "asset_history_action_idx" ON "asset_history"("action");

-- CreateIndex
CREATE INDEX "asset_history_performed_by_id_idx" ON "asset_history"("performed_by_id");

-- CreateIndex
CREATE UNIQUE INDEX "accessories_sku_key" ON "accessories"("sku");

-- CreateIndex
CREATE INDEX "accessories_category_idx" ON "accessories"("category");

-- CreateIndex
CREATE INDEX "accessories_location_id_idx" ON "accessories"("location_id");

-- CreateIndex
CREATE INDEX "accessory_assignments_accessory_id_status_idx" ON "accessory_assignments"("accessory_id", "status");

-- CreateIndex
CREATE INDEX "accessory_assignments_employee_id_status_idx" ON "accessory_assignments"("employee_id", "status");

-- CreateIndex
CREATE INDEX "accessory_assignments_asset_assignment_id_idx" ON "accessory_assignments"("asset_assignment_id");

-- CreateIndex
CREATE UNIQUE INDEX "maintenance_number_key" ON "maintenance"("number");

-- CreateIndex
CREATE INDEX "maintenance_asset_id_created_at_idx" ON "maintenance"("asset_id", "created_at" DESC);

-- CreateIndex
CREATE INDEX "maintenance_status_idx" ON "maintenance"("status");

-- CreateIndex
CREATE INDEX "maintenance_technician_id_status_idx" ON "maintenance"("technician_id", "status");

-- CreateIndex
CREATE INDEX "maintenance_vendor_id_idx" ON "maintenance"("vendor_id");

-- CreateIndex
CREATE INDEX "maintenance_ticket_id_idx" ON "maintenance"("ticket_id");

-- CreateIndex
CREATE INDEX "software_publisher_id_idx" ON "software"("publisher_id");

-- CreateIndex
CREATE UNIQUE INDEX "software_name_version_key" ON "software"("name", "version");

-- CreateIndex
CREATE INDEX "software_licenses_software_id_idx" ON "software_licenses"("software_id");

-- CreateIndex
CREATE INDEX "software_licenses_expiry_date_idx" ON "software_licenses"("expiry_date");

-- CreateIndex
CREATE INDEX "software_assignments_license_id_unassigned_at_idx" ON "software_assignments"("license_id", "unassigned_at");

-- CreateIndex
CREATE INDEX "software_assignments_asset_id_idx" ON "software_assignments"("asset_id");

-- CreateIndex
CREATE INDEX "software_assignments_employee_id_idx" ON "software_assignments"("employee_id");

-- CreateIndex
CREATE UNIQUE INDEX "tickets_number_key" ON "tickets"("number");

-- CreateIndex
CREATE INDEX "tickets_status_priority_idx" ON "tickets"("status", "priority");

-- CreateIndex
CREATE INDEX "tickets_requester_id_idx" ON "tickets"("requester_id");

-- CreateIndex
CREATE INDEX "tickets_assignee_id_status_idx" ON "tickets"("assignee_id", "status");

-- CreateIndex
CREATE INDEX "tickets_asset_id_idx" ON "tickets"("asset_id");

-- CreateIndex
CREATE INDEX "tickets_created_at_idx" ON "tickets"("created_at" DESC);

-- CreateIndex
CREATE INDEX "ticket_comments_ticket_id_created_at_idx" ON "ticket_comments"("ticket_id", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "documents_storage_key_key" ON "documents"("storage_key");

-- CreateIndex
CREATE INDEX "documents_asset_id_idx" ON "documents"("asset_id");

-- CreateIndex
CREATE INDEX "documents_assignment_id_idx" ON "documents"("assignment_id");

-- CreateIndex
CREATE INDEX "documents_maintenance_id_idx" ON "documents"("maintenance_id");

-- CreateIndex
CREATE INDEX "documents_purchase_id_idx" ON "documents"("purchase_id");

-- CreateIndex
CREATE INDEX "documents_software_license_id_idx" ON "documents"("software_license_id");

-- CreateIndex
CREATE INDEX "documents_ticket_id_idx" ON "documents"("ticket_id");

-- CreateIndex
CREATE INDEX "documents_audit_session_id_idx" ON "documents"("audit_session_id");

-- CreateIndex
CREATE INDEX "documents_employee_id_idx" ON "documents"("employee_id");

-- CreateIndex
CREATE INDEX "documents_type_idx" ON "documents"("type");

-- CreateIndex
CREATE UNIQUE INDEX "audit_sessions_number_key" ON "audit_sessions"("number");

-- CreateIndex
CREATE INDEX "audit_sessions_status_idx" ON "audit_sessions"("status");

-- CreateIndex
CREATE INDEX "audit_sessions_location_id_idx" ON "audit_sessions"("location_id");

-- CreateIndex
CREATE INDEX "audit_sessions_department_id_idx" ON "audit_sessions"("department_id");

-- CreateIndex
CREATE INDEX "audit_items_audit_session_id_result_idx" ON "audit_items"("audit_session_id", "result");

-- CreateIndex
CREATE INDEX "audit_items_asset_id_idx" ON "audit_items"("asset_id");

-- CreateIndex
CREATE UNIQUE INDEX "audit_items_audit_session_id_asset_id_key" ON "audit_items"("audit_session_id", "asset_id");

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");

-- CreateIndex
CREATE UNIQUE INDEX "users_employee_id_key" ON "users"("employee_id");

-- CreateIndex
CREATE INDEX "users_status_idx" ON "users"("status");

-- CreateIndex
CREATE UNIQUE INDEX "roles_name_key" ON "roles"("name");

-- CreateIndex
CREATE UNIQUE INDEX "permissions_key_key" ON "permissions"("key");

-- CreateIndex
CREATE INDEX "permissions_module_idx" ON "permissions"("module");

-- CreateIndex
CREATE INDEX "user_roles_role_id_idx" ON "user_roles"("role_id");

-- CreateIndex
CREATE INDEX "role_permissions_permission_id_idx" ON "role_permissions"("permission_id");

-- CreateIndex
CREATE INDEX "notifications_user_id_read_at_created_at_idx" ON "notifications"("user_id", "read_at", "created_at" DESC);

-- CreateIndex
CREATE INDEX "activity_logs_entity_type_entity_id_idx" ON "activity_logs"("entity_type", "entity_id");

-- CreateIndex
CREATE INDEX "activity_logs_actor_id_created_at_idx" ON "activity_logs"("actor_id", "created_at" DESC);

-- CreateIndex
CREATE INDEX "activity_logs_action_idx" ON "activity_logs"("action");

-- CreateIndex
CREATE INDEX "activity_logs_created_at_idx" ON "activity_logs"("created_at" DESC);

-- AddForeignKey
ALTER TABLE "departments" ADD CONSTRAINT "departments_manager_id_fkey" FOREIGN KEY ("manager_id") REFERENCES "employees"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "locations" ADD CONSTRAINT "locations_parent_id_fkey" FOREIGN KEY ("parent_id") REFERENCES "locations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "employees" ADD CONSTRAINT "employees_department_id_fkey" FOREIGN KEY ("department_id") REFERENCES "departments"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "employees" ADD CONSTRAINT "employees_location_id_fkey" FOREIGN KEY ("location_id") REFERENCES "locations"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "employees" ADD CONSTRAINT "employees_manager_id_fkey" FOREIGN KEY ("manager_id") REFERENCES "employees"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchases" ADD CONSTRAINT "purchases_vendor_id_fkey" FOREIGN KEY ("vendor_id") REFERENCES "vendors"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchases" ADD CONSTRAINT "purchases_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "assets" ADD CONSTRAINT "assets_asset_type_id_fkey" FOREIGN KEY ("asset_type_id") REFERENCES "asset_types"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "assets" ADD CONSTRAINT "assets_location_id_fkey" FOREIGN KEY ("location_id") REFERENCES "locations"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "assets" ADD CONSTRAINT "assets_department_id_fkey" FOREIGN KEY ("department_id") REFERENCES "departments"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "assets" ADD CONSTRAINT "assets_purchase_id_fkey" FOREIGN KEY ("purchase_id") REFERENCES "purchases"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "assets" ADD CONSTRAINT "assets_vendor_id_fkey" FOREIGN KEY ("vendor_id") REFERENCES "vendors"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "assets" ADD CONSTRAINT "assets_warranty_provider_id_fkey" FOREIGN KEY ("warranty_provider_id") REFERENCES "vendors"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "assets" ADD CONSTRAINT "assets_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "assets" ADD CONSTRAINT "assets_updated_by_id_fkey" FOREIGN KEY ("updated_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "asset_assignments" ADD CONSTRAINT "asset_assignments_asset_id_fkey" FOREIGN KEY ("asset_id") REFERENCES "assets"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "asset_assignments" ADD CONSTRAINT "asset_assignments_employee_id_fkey" FOREIGN KEY ("employee_id") REFERENCES "employees"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "asset_assignments" ADD CONSTRAINT "asset_assignments_location_id_fkey" FOREIGN KEY ("location_id") REFERENCES "locations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "asset_assignments" ADD CONSTRAINT "asset_assignments_assigned_by_id_fkey" FOREIGN KEY ("assigned_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "asset_assignments" ADD CONSTRAINT "asset_assignments_returned_by_id_fkey" FOREIGN KEY ("returned_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "asset_assignments" ADD CONSTRAINT "asset_assignments_previous_assignment_id_fkey" FOREIGN KEY ("previous_assignment_id") REFERENCES "asset_assignments"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "asset_history" ADD CONSTRAINT "asset_history_asset_id_fkey" FOREIGN KEY ("asset_id") REFERENCES "assets"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "asset_history" ADD CONSTRAINT "asset_history_from_location_id_fkey" FOREIGN KEY ("from_location_id") REFERENCES "locations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "asset_history" ADD CONSTRAINT "asset_history_to_location_id_fkey" FOREIGN KEY ("to_location_id") REFERENCES "locations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "asset_history" ADD CONSTRAINT "asset_history_assignment_id_fkey" FOREIGN KEY ("assignment_id") REFERENCES "asset_assignments"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "asset_history" ADD CONSTRAINT "asset_history_maintenance_id_fkey" FOREIGN KEY ("maintenance_id") REFERENCES "maintenance"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "asset_history" ADD CONSTRAINT "asset_history_performed_by_id_fkey" FOREIGN KEY ("performed_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "accessories" ADD CONSTRAINT "accessories_location_id_fkey" FOREIGN KEY ("location_id") REFERENCES "locations"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "accessories" ADD CONSTRAINT "accessories_purchase_id_fkey" FOREIGN KEY ("purchase_id") REFERENCES "purchases"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "accessory_assignments" ADD CONSTRAINT "accessory_assignments_accessory_id_fkey" FOREIGN KEY ("accessory_id") REFERENCES "accessories"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "accessory_assignments" ADD CONSTRAINT "accessory_assignments_employee_id_fkey" FOREIGN KEY ("employee_id") REFERENCES "employees"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "accessory_assignments" ADD CONSTRAINT "accessory_assignments_asset_assignment_id_fkey" FOREIGN KEY ("asset_assignment_id") REFERENCES "asset_assignments"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "accessory_assignments" ADD CONSTRAINT "accessory_assignments_assigned_by_id_fkey" FOREIGN KEY ("assigned_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "accessory_assignments" ADD CONSTRAINT "accessory_assignments_returned_by_id_fkey" FOREIGN KEY ("returned_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "maintenance" ADD CONSTRAINT "maintenance_asset_id_fkey" FOREIGN KEY ("asset_id") REFERENCES "assets"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "maintenance" ADD CONSTRAINT "maintenance_reported_by_id_fkey" FOREIGN KEY ("reported_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "maintenance" ADD CONSTRAINT "maintenance_technician_id_fkey" FOREIGN KEY ("technician_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "maintenance" ADD CONSTRAINT "maintenance_vendor_id_fkey" FOREIGN KEY ("vendor_id") REFERENCES "vendors"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "maintenance" ADD CONSTRAINT "maintenance_ticket_id_fkey" FOREIGN KEY ("ticket_id") REFERENCES "tickets"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "software" ADD CONSTRAINT "software_publisher_id_fkey" FOREIGN KEY ("publisher_id") REFERENCES "vendors"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "software_licenses" ADD CONSTRAINT "software_licenses_software_id_fkey" FOREIGN KEY ("software_id") REFERENCES "software"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "software_licenses" ADD CONSTRAINT "software_licenses_purchase_id_fkey" FOREIGN KEY ("purchase_id") REFERENCES "purchases"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "software_licenses" ADD CONSTRAINT "software_licenses_vendor_id_fkey" FOREIGN KEY ("vendor_id") REFERENCES "vendors"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "software_assignments" ADD CONSTRAINT "software_assignments_license_id_fkey" FOREIGN KEY ("license_id") REFERENCES "software_licenses"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "software_assignments" ADD CONSTRAINT "software_assignments_asset_id_fkey" FOREIGN KEY ("asset_id") REFERENCES "assets"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "software_assignments" ADD CONSTRAINT "software_assignments_employee_id_fkey" FOREIGN KEY ("employee_id") REFERENCES "employees"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "software_assignments" ADD CONSTRAINT "software_assignments_assigned_by_id_fkey" FOREIGN KEY ("assigned_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "software_assignments" ADD CONSTRAINT "software_assignments_unassigned_by_id_fkey" FOREIGN KEY ("unassigned_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tickets" ADD CONSTRAINT "tickets_requester_id_fkey" FOREIGN KEY ("requester_id") REFERENCES "employees"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tickets" ADD CONSTRAINT "tickets_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tickets" ADD CONSTRAINT "tickets_assignee_id_fkey" FOREIGN KEY ("assignee_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tickets" ADD CONSTRAINT "tickets_asset_id_fkey" FOREIGN KEY ("asset_id") REFERENCES "assets"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ticket_comments" ADD CONSTRAINT "ticket_comments_ticket_id_fkey" FOREIGN KEY ("ticket_id") REFERENCES "tickets"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ticket_comments" ADD CONSTRAINT "ticket_comments_author_id_fkey" FOREIGN KEY ("author_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "documents" ADD CONSTRAINT "documents_asset_id_fkey" FOREIGN KEY ("asset_id") REFERENCES "assets"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "documents" ADD CONSTRAINT "documents_assignment_id_fkey" FOREIGN KEY ("assignment_id") REFERENCES "asset_assignments"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "documents" ADD CONSTRAINT "documents_maintenance_id_fkey" FOREIGN KEY ("maintenance_id") REFERENCES "maintenance"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "documents" ADD CONSTRAINT "documents_purchase_id_fkey" FOREIGN KEY ("purchase_id") REFERENCES "purchases"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "documents" ADD CONSTRAINT "documents_software_license_id_fkey" FOREIGN KEY ("software_license_id") REFERENCES "software_licenses"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "documents" ADD CONSTRAINT "documents_ticket_id_fkey" FOREIGN KEY ("ticket_id") REFERENCES "tickets"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "documents" ADD CONSTRAINT "documents_audit_session_id_fkey" FOREIGN KEY ("audit_session_id") REFERENCES "audit_sessions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "documents" ADD CONSTRAINT "documents_employee_id_fkey" FOREIGN KEY ("employee_id") REFERENCES "employees"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "documents" ADD CONSTRAINT "documents_uploaded_by_id_fkey" FOREIGN KEY ("uploaded_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_sessions" ADD CONSTRAINT "audit_sessions_location_id_fkey" FOREIGN KEY ("location_id") REFERENCES "locations"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_sessions" ADD CONSTRAINT "audit_sessions_department_id_fkey" FOREIGN KEY ("department_id") REFERENCES "departments"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_sessions" ADD CONSTRAINT "audit_sessions_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_sessions" ADD CONSTRAINT "audit_sessions_completed_by_id_fkey" FOREIGN KEY ("completed_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_items" ADD CONSTRAINT "audit_items_audit_session_id_fkey" FOREIGN KEY ("audit_session_id") REFERENCES "audit_sessions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_items" ADD CONSTRAINT "audit_items_asset_id_fkey" FOREIGN KEY ("asset_id") REFERENCES "assets"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_items" ADD CONSTRAINT "audit_items_expected_location_id_fkey" FOREIGN KEY ("expected_location_id") REFERENCES "locations"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_items" ADD CONSTRAINT "audit_items_observed_location_id_fkey" FOREIGN KEY ("observed_location_id") REFERENCES "locations"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_items" ADD CONSTRAINT "audit_items_scanned_by_id_fkey" FOREIGN KEY ("scanned_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_items" ADD CONSTRAINT "audit_items_reviewed_by_id_fkey" FOREIGN KEY ("reviewed_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "users" ADD CONSTRAINT "users_employee_id_fkey" FOREIGN KEY ("employee_id") REFERENCES "employees"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_roles" ADD CONSTRAINT "user_roles_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_roles" ADD CONSTRAINT "user_roles_role_id_fkey" FOREIGN KEY ("role_id") REFERENCES "roles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_roles" ADD CONSTRAINT "user_roles_assigned_by_id_fkey" FOREIGN KEY ("assigned_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "role_permissions" ADD CONSTRAINT "role_permissions_role_id_fkey" FOREIGN KEY ("role_id") REFERENCES "roles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "role_permissions" ADD CONSTRAINT "role_permissions_permission_id_fkey" FOREIGN KEY ("permission_id") REFERENCES "permissions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "activity_logs" ADD CONSTRAINT "activity_logs_actor_id_fkey" FOREIGN KEY ("actor_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ═════════════════════════════════════════════════════════════════════════════
-- Integrity rules not expressible in Prisma schema (hand-written).
-- ═════════════════════════════════════════════════════════════════════════════

-- Asset assignments: one ACTIVE assignment per asset; assignee required; status ⇔ returned_at.
CREATE UNIQUE INDEX "asset_assignments_one_active_per_asset"
  ON "asset_assignments" ("asset_id") WHERE "status" = 'ACTIVE';
ALTER TABLE "asset_assignments"
  ADD CONSTRAINT "asset_assignments_assignee_required"
    CHECK ("employee_id" IS NOT NULL OR "location_id" IS NOT NULL),
  ADD CONSTRAINT "asset_assignments_returned_consistency"
    CHECK (("status" = 'ACTIVE') = ("returned_at" IS NULL)),
  ADD CONSTRAINT "asset_assignments_returned_after_assigned"
    CHECK ("returned_at" IS NULL OR "returned_at" >= "assigned_at");

-- Assets
ALTER TABLE "assets"
  ADD CONSTRAINT "assets_purchase_cost_non_negative"
    CHECK ("purchase_cost" IS NULL OR "purchase_cost" >= 0),
  ADD CONSTRAINT "assets_currency_iso"
    CHECK ("currency" IS NULL OR "currency" ~ '^[A-Z]{3}$'),
  ADD CONSTRAINT "assets_warranty_dates"
    CHECK ("warranty_end_date" IS NULL OR "warranty_start_date" IS NULL OR "warranty_end_date" >= "warranty_start_date");

-- Purchases
ALTER TABLE "purchases"
  ADD CONSTRAINT "purchases_amounts_non_negative"
    CHECK ("subtotal" >= 0 AND "tax_amount" >= 0 AND "total_amount" >= 0),
  ADD CONSTRAINT "purchases_currency_iso"
    CHECK ("currency" ~ '^[A-Z]{3}$');

-- Accessories: stock can never go negative or exceed the total.
ALTER TABLE "accessories"
  ADD CONSTRAINT "accessories_quantities_valid"
    CHECK ("quantity_total" >= 0 AND "quantity_available" >= 0
           AND "quantity_available" <= "quantity_total" AND "min_stock_level" >= 0),
  ADD CONSTRAINT "accessories_unit_cost_non_negative"
    CHECK ("unit_cost" IS NULL OR "unit_cost" >= 0);
ALTER TABLE "accessory_assignments"
  ADD CONSTRAINT "accessory_assignments_quantity_positive" CHECK ("quantity" > 0),
  ADD CONSTRAINT "accessory_assignments_returned_consistency"
    CHECK (("status" = 'ACTIVE') = ("returned_at" IS NULL));

-- Maintenance
ALTER TABLE "maintenance"
  ADD CONSTRAINT "maintenance_costs_non_negative"
    CHECK (COALESCE("labor_cost", 0) >= 0 AND COALESCE("parts_cost", 0) >= 0 AND COALESCE("total_cost", 0) >= 0),
  ADD CONSTRAINT "maintenance_completed_after_started"
    CHECK ("completed_at" IS NULL OR "started_at" IS NULL OR "completed_at" >= "started_at");

-- Software licenses & seat assignments
ALTER TABLE "software_licenses"
  ADD CONSTRAINT "software_licenses_seats_non_negative" CHECK ("seats" IS NULL OR "seats" >= 0),
  ADD CONSTRAINT "software_licenses_cost_non_negative" CHECK ("cost" IS NULL OR "cost" >= 0),
  ADD CONSTRAINT "software_licenses_dates"
    CHECK ("expiry_date" IS NULL OR "start_date" IS NULL OR "expiry_date" >= "start_date");
ALTER TABLE "software_assignments"
  ADD CONSTRAINT "software_assignments_exactly_one_target"
    CHECK (num_nonnulls("asset_id", "employee_id") = 1);
CREATE UNIQUE INDEX "software_assignments_active_asset"
  ON "software_assignments" ("license_id", "asset_id")
  WHERE "unassigned_at" IS NULL AND "asset_id" IS NOT NULL;
CREATE UNIQUE INDEX "software_assignments_active_employee"
  ON "software_assignments" ("license_id", "employee_id")
  WHERE "unassigned_at" IS NULL AND "employee_id" IS NOT NULL;

-- Documents
ALTER TABLE "documents"
  ADD CONSTRAINT "documents_size_non_negative" CHECK ("size_bytes" >= 0);

-- Audit items: either a known asset or the raw scanned code.
ALTER TABLE "audit_items"
  ADD CONSTRAINT "audit_items_asset_or_code"
    CHECK ("asset_id" IS NOT NULL OR "scanned_code" IS NOT NULL);

-- Emails are stored normalised so unique indexes are case-insensitive in practice.
ALTER TABLE "users"
  ADD CONSTRAINT "users_email_lowercase" CHECK ("email" = lower("email"));
ALTER TABLE "employees"
  ADD CONSTRAINT "employees_email_lowercase" CHECK ("email" = lower("email"));

-- Trails are append-only: history and activity logs cannot be edited or deleted.
CREATE FUNCTION "prevent_append_only_modification"() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION '% is append-only; % is not allowed', TG_TABLE_NAME, TG_OP
    USING ERRCODE = 'restrict_violation';
END;
$$;

CREATE TRIGGER "asset_history_append_only"
  BEFORE UPDATE OR DELETE ON "asset_history"
  FOR EACH ROW EXECUTE FUNCTION "prevent_append_only_modification"();

CREATE TRIGGER "activity_logs_append_only"
  BEFORE UPDATE OR DELETE ON "activity_logs"
  FOR EACH ROW EXECUTE FUNCTION "prevent_append_only_modification"();
