-- CreateEnum
CREATE TYPE "sim_status" AS ENUM ('ACTIVE', 'PARKED', 'SUSPENDED', 'SPARE', 'CANCELLED');

-- CreateTable
CREATE TABLE "sim_plans" (
    "id" UUID NOT NULL,
    "name" VARCHAR(120) NOT NULL,
    "provider" VARCHAR(80),
    "monthly_charge" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "currency" CHAR(3) NOT NULL,
    "remarks" TEXT,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    "deleted_at" TIMESTAMPTZ(6),

    CONSTRAINT "sim_plans_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sim_cards" (
    "id" UUID NOT NULL,
    "phone_number" VARCHAR(40) NOT NULL,
    "sim_number" VARCHAR(32),
    "provider" VARCHAR(80),
    "plan_id" UUID,
    "status" "sim_status" NOT NULL DEFAULT 'SPARE',
    "employee_id" UUID,
    "asset_id" UUID,
    "activated_at" DATE,
    "cancelled_at" DATE,
    "remarks" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    "deleted_at" TIMESTAMPTZ(6),

    CONSTRAINT "sim_cards_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sim_usages" (
    "id" UUID NOT NULL,
    "sim_card_id" UUID NOT NULL,
    "period" DATE NOT NULL,
    "plan_id" UUID,
    "monthly_charge" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "excess_usage" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "international_charges" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "roaming_charges" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "parking_charges" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "total_charge" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "currency" CHAR(3) NOT NULL,
    "remarks" TEXT,
    "recorded_by_id" UUID,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "sim_usages_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "sim_plans_name_key" ON "sim_plans"("name");

-- CreateIndex
CREATE UNIQUE INDEX "sim_cards_phone_number_key" ON "sim_cards"("phone_number");

-- CreateIndex
CREATE UNIQUE INDEX "sim_cards_sim_number_key" ON "sim_cards"("sim_number");

-- CreateIndex
CREATE INDEX "sim_cards_status_idx" ON "sim_cards"("status");

-- CreateIndex
CREATE INDEX "sim_cards_employee_id_idx" ON "sim_cards"("employee_id");

-- CreateIndex
CREATE INDEX "sim_cards_asset_id_idx" ON "sim_cards"("asset_id");

-- CreateIndex
CREATE INDEX "sim_usages_period_idx" ON "sim_usages"("period");

-- CreateIndex
CREATE UNIQUE INDEX "sim_usages_sim_card_id_period_key" ON "sim_usages"("sim_card_id", "period");

-- AddForeignKey
ALTER TABLE "sim_cards" ADD CONSTRAINT "sim_cards_plan_id_fkey" FOREIGN KEY ("plan_id") REFERENCES "sim_plans"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sim_cards" ADD CONSTRAINT "sim_cards_employee_id_fkey" FOREIGN KEY ("employee_id") REFERENCES "employees"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sim_cards" ADD CONSTRAINT "sim_cards_asset_id_fkey" FOREIGN KEY ("asset_id") REFERENCES "assets"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sim_usages" ADD CONSTRAINT "sim_usages_sim_card_id_fkey" FOREIGN KEY ("sim_card_id") REFERENCES "sim_cards"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sim_usages" ADD CONSTRAINT "sim_usages_plan_id_fkey" FOREIGN KEY ("plan_id") REFERENCES "sim_plans"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sim_usages" ADD CONSTRAINT "sim_usages_recorded_by_id_fkey" FOREIGN KEY ("recorded_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;


-- Charges are never negative, and the stored total always matches the parts.
ALTER TABLE "sim_plans" ADD CONSTRAINT "sim_plans_monthly_charge_check" CHECK ("monthly_charge" >= 0);
ALTER TABLE "sim_usages" ADD CONSTRAINT "sim_usages_charges_check" CHECK (
  "monthly_charge" >= 0 AND "excess_usage" >= 0 AND "international_charges" >= 0
  AND "roaming_charges" >= 0 AND "parking_charges" >= 0
);
ALTER TABLE "sim_usages" ADD CONSTRAINT "sim_usages_total_check" CHECK (
  "total_charge" = "monthly_charge" + "excess_usage" + "international_charges"
                 + "roaming_charges" + "parking_charges"
);
-- Billing months are whole months.
ALTER TABLE "sim_usages" ADD CONSTRAINT "sim_usages_period_check" CHECK (date_part('day', "period") = 1);
