-- The printed ASSET REQUEST FORM ticks one of five request types.
ALTER TYPE "request_type" ADD VALUE IF NOT EXISTS 'UPGRADE';
ALTER TYPE "request_type" ADD VALUE IF NOT EXISTS 'TEMPORARY';

-- Extra details the printed form asks for.
ALTER TABLE "asset_requests"
  ADD COLUMN "preferred_model" VARCHAR(160),
  ADD COLUMN "accessories_required" VARCHAR(300),
  ADD COLUMN "type_detail" VARCHAR(300);

-- CreateEnum
CREATE TYPE "sim_swap_reason" AS ENUM ('LOW_USAGE', 'LOST', 'STOLEN', 'DAMAGED', 'UPGRADE', 'OTHER');

-- CreateTable
CREATE TABLE "sim_swaps" (
    "id" UUID NOT NULL,
    "number" SERIAL NOT NULL,
    "sim_card_id" UUID NOT NULL,
    "from_employee_id" UUID,
    "to_employee_id" UUID,
    "reason" "sim_swap_reason" NOT NULL DEFAULT 'OTHER',
    "reason_detail" VARCHAR(300),
    "new_sim_number" VARCHAR(32),
    "previous_sim_number" VARCHAR(32),
    "swapped_at" DATE NOT NULL,
    "remarks" TEXT,
    "created_by_id" UUID,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "sim_swaps_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "sim_swaps_number_key" ON "sim_swaps"("number");

-- CreateIndex
CREATE INDEX "sim_swaps_sim_card_id_idx" ON "sim_swaps"("sim_card_id");

-- CreateIndex
CREATE INDEX "sim_swaps_swapped_at_idx" ON "sim_swaps"("swapped_at" DESC);

-- AddForeignKey
ALTER TABLE "sim_swaps" ADD CONSTRAINT "sim_swaps_sim_card_id_fkey" FOREIGN KEY ("sim_card_id") REFERENCES "sim_cards"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sim_swaps" ADD CONSTRAINT "sim_swaps_from_employee_id_fkey" FOREIGN KEY ("from_employee_id") REFERENCES "employees"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sim_swaps" ADD CONSTRAINT "sim_swaps_to_employee_id_fkey" FOREIGN KEY ("to_employee_id") REFERENCES "employees"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sim_swaps" ADD CONSTRAINT "sim_swaps_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- A swap has to move something: a holder on one side, or a replacement SIM for the same holder.
ALTER TABLE "sim_swaps" ADD CONSTRAINT "sim_swaps_holders_check" CHECK (
  "from_employee_id" IS NOT NULL OR "to_employee_id" IS NOT NULL OR "new_sim_number" IS NOT NULL
);
