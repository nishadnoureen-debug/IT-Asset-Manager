-- Helpdesk tickets are replaced by asset requests with a single approval step.
-- Ticket data is not migrated: requests are a different workflow (request -> approve -> fulfil).

-- CreateEnum
CREATE TYPE "request_type" AS ENUM ('NEW_ASSET', 'REPLACEMENT', 'ACCESSORY', 'SOFTWARE', 'REPAIR', 'OTHER');

-- CreateEnum
CREATE TYPE "request_status" AS ENUM ('SUBMITTED', 'APPROVED', 'REJECTED', 'FULFILLED', 'CANCELLED');

-- AlterEnum
ALTER TYPE "document_type" ADD VALUE 'REQUEST_FORM';

-- AlterEnum
BEGIN;
CREATE TYPE "notification_type_new" AS ENUM ('WARRANTY_EXPIRING', 'LICENSE_EXPIRING', 'OVERDUE_RETURN', 'MAINTENANCE_DUE', 'MAINTENANCE_UPDATE', 'REQUEST_UPDATE', 'AUDIT_ASSIGNED', 'ASSIGNMENT_ACKNOWLEDGEMENT', 'SYSTEM');
ALTER TABLE "notifications" ALTER COLUMN "type" TYPE "notification_type_new" USING ("type"::text::"notification_type_new");
ALTER TYPE "notification_type" RENAME TO "notification_type_old";
ALTER TYPE "notification_type_new" RENAME TO "notification_type";
DROP TYPE "public"."notification_type_old";
COMMIT;

-- DropForeignKey
ALTER TABLE "documents" DROP CONSTRAINT "documents_ticket_id_fkey";

-- DropForeignKey
ALTER TABLE "maintenance" DROP CONSTRAINT "maintenance_ticket_id_fkey";

-- DropForeignKey
ALTER TABLE "ticket_comments" DROP CONSTRAINT "ticket_comments_author_id_fkey";

-- DropForeignKey
ALTER TABLE "ticket_comments" DROP CONSTRAINT "ticket_comments_ticket_id_fkey";

-- DropForeignKey
ALTER TABLE "tickets" DROP CONSTRAINT "tickets_asset_id_fkey";

-- DropForeignKey
ALTER TABLE "tickets" DROP CONSTRAINT "tickets_assignee_id_fkey";

-- DropForeignKey
ALTER TABLE "tickets" DROP CONSTRAINT "tickets_created_by_id_fkey";

-- DropForeignKey
ALTER TABLE "tickets" DROP CONSTRAINT "tickets_requester_id_fkey";

-- DropIndex
DROP INDEX "documents_ticket_id_idx";

-- DropIndex
DROP INDEX "maintenance_ticket_id_idx";

-- AlterTable
ALTER TABLE "documents" DROP COLUMN "ticket_id",
ADD COLUMN     "asset_request_id" UUID;

-- AlterTable
ALTER TABLE "maintenance" DROP COLUMN "ticket_id";

-- DropTable
DROP TABLE "ticket_comments";

-- DropTable
DROP TABLE "tickets";

-- DropEnum
DROP TYPE "ticket_category";

-- DropEnum
DROP TYPE "ticket_status";

-- CreateTable
CREATE TABLE "asset_requests" (
    "id" UUID NOT NULL,
    "number" SERIAL NOT NULL,
    "title" VARCHAR(200) NOT NULL,
    "type" "request_type" NOT NULL DEFAULT 'NEW_ASSET',
    "priority" "priority" NOT NULL DEFAULT 'MEDIUM',
    "status" "request_status" NOT NULL DEFAULT 'SUBMITTED',
    "employee_id" UUID,
    "created_by_id" UUID,
    "asset_type_id" UUID,
    "quantity" INTEGER NOT NULL DEFAULT 1,
    "justification" TEXT NOT NULL,
    "needed_by" DATE,
    "decision_by_id" UUID,
    "decision_at" TIMESTAMPTZ(6),
    "decision_notes" TEXT,
    "asset_id" UUID,
    "fulfilled_by_id" UUID,
    "fulfilled_at" TIMESTAMPTZ(6),
    "cancelled_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "asset_requests_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "asset_requests_number_key" ON "asset_requests"("number");

-- CreateIndex
CREATE INDEX "asset_requests_status_priority_idx" ON "asset_requests"("status", "priority");

-- CreateIndex
CREATE INDEX "asset_requests_employee_id_idx" ON "asset_requests"("employee_id");

-- CreateIndex
CREATE INDEX "asset_requests_created_by_id_idx" ON "asset_requests"("created_by_id");

-- CreateIndex
CREATE INDEX "asset_requests_asset_id_idx" ON "asset_requests"("asset_id");

-- CreateIndex
CREATE INDEX "asset_requests_created_at_idx" ON "asset_requests"("created_at" DESC);

-- CreateIndex
CREATE INDEX "documents_asset_request_id_idx" ON "documents"("asset_request_id");

-- AddForeignKey
ALTER TABLE "asset_requests" ADD CONSTRAINT "asset_requests_employee_id_fkey" FOREIGN KEY ("employee_id") REFERENCES "employees"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "asset_requests" ADD CONSTRAINT "asset_requests_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "asset_requests" ADD CONSTRAINT "asset_requests_asset_type_id_fkey" FOREIGN KEY ("asset_type_id") REFERENCES "asset_types"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "asset_requests" ADD CONSTRAINT "asset_requests_decision_by_id_fkey" FOREIGN KEY ("decision_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "asset_requests" ADD CONSTRAINT "asset_requests_asset_id_fkey" FOREIGN KEY ("asset_id") REFERENCES "assets"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "asset_requests" ADD CONSTRAINT "asset_requests_fulfilled_by_id_fkey" FOREIGN KEY ("fulfilled_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "documents" ADD CONSTRAINT "documents_asset_request_id_fkey" FOREIGN KEY ("asset_request_id") REFERENCES "asset_requests"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

