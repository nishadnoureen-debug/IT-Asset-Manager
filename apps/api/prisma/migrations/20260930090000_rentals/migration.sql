-- CreateEnum
CREATE TYPE "rental_item_type" AS ENUM ('WIFI_CARD', 'WASHING_MACHINE', 'OTHER');

-- CreateEnum
CREATE TYPE "rental_item_status" AS ENUM ('AVAILABLE', 'RENTED', 'UNDER_REPAIR', 'RETIRED');

-- CreateEnum
CREATE TYPE "rental_status" AS ENUM ('ACTIVE', 'COMPLETED', 'CANCELLED');

-- CreateTable
CREATE TABLE "camps" (
    "id" UUID NOT NULL,
    "name" VARCHAR(120) NOT NULL,
    "code" VARCHAR(20),
    "location" VARCHAR(200),
    "remarks" TEXT,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    "deleted_at" TIMESTAMPTZ(6),

    CONSTRAINT "camps_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "rental_items" (
    "id" UUID NOT NULL,
    "camp_id" UUID NOT NULL,
    "type" "rental_item_type" NOT NULL,
    "name" VARCHAR(120) NOT NULL,
    "code" VARCHAR(60),
    "provider" VARCHAR(80),
    "standard_charge" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "currency" CHAR(3) NOT NULL,
    "status" "rental_item_status" NOT NULL DEFAULT 'AVAILABLE',
    "remarks" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    "deleted_at" TIMESTAMPTZ(6),

    CONSTRAINT "rental_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "rentals" (
    "id" UUID NOT NULL,
    "number" SERIAL NOT NULL,
    "item_id" UUID NOT NULL,
    "employee_id" UUID NOT NULL,
    "start_at" TIMESTAMPTZ(6) NOT NULL,
    "end_at" TIMESTAMPTZ(6),
    "charge" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "currency" CHAR(3) NOT NULL,
    "status" "rental_status" NOT NULL DEFAULT 'ACTIVE',
    "remarks" TEXT,
    "created_by_id" UUID,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "rentals_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "camps_name_key" ON "camps"("name");

-- CreateIndex
CREATE UNIQUE INDEX "camps_code_key" ON "camps"("code");

-- CreateIndex
CREATE UNIQUE INDEX "rental_items_code_key" ON "rental_items"("code");

-- CreateIndex
CREATE INDEX "rental_items_camp_id_idx" ON "rental_items"("camp_id");

-- CreateIndex
CREATE INDEX "rental_items_type_idx" ON "rental_items"("type");

-- CreateIndex
CREATE INDEX "rental_items_status_idx" ON "rental_items"("status");

-- CreateIndex
CREATE UNIQUE INDEX "rentals_number_key" ON "rentals"("number");

-- CreateIndex
CREATE INDEX "rentals_item_id_start_at_idx" ON "rentals"("item_id", "start_at" DESC);

-- CreateIndex
CREATE INDEX "rentals_employee_id_idx" ON "rentals"("employee_id");

-- CreateIndex
CREATE INDEX "rentals_status_idx" ON "rentals"("status");

-- AddForeignKey
ALTER TABLE "rental_items" ADD CONSTRAINT "rental_items_camp_id_fkey" FOREIGN KEY ("camp_id") REFERENCES "camps"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "rentals" ADD CONSTRAINT "rentals_item_id_fkey" FOREIGN KEY ("item_id") REFERENCES "rental_items"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "rentals" ADD CONSTRAINT "rentals_employee_id_fkey" FOREIGN KEY ("employee_id") REFERENCES "employees"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "rentals" ADD CONSTRAINT "rentals_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;


-- Charges are never negative, and a rental that has ended ends after it started.
ALTER TABLE "rental_items" ADD CONSTRAINT "rental_items_charge_check" CHECK ("standard_charge" >= 0);
ALTER TABLE "rentals" ADD CONSTRAINT "rentals_charge_check" CHECK ("charge" >= 0);
ALTER TABLE "rentals" ADD CONSTRAINT "rentals_period_check" CHECK ("end_at" IS NULL OR "end_at" > "start_at");
