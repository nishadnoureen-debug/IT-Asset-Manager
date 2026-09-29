-- A line can simply move to another employee, with the device that employee holds.
ALTER TYPE "sim_swap_reason" ADD VALUE IF NOT EXISTS 'TRANSFER';

-- The device the line sits in after the swap, and the one it sat in before.
ALTER TABLE "sim_swaps"
  ADD COLUMN "asset_id" UUID,
  ADD COLUMN "previous_asset_id" UUID;

-- AddForeignKey
ALTER TABLE "sim_swaps" ADD CONSTRAINT "sim_swaps_asset_id_fkey" FOREIGN KEY ("asset_id") REFERENCES "assets"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sim_swaps" ADD CONSTRAINT "sim_swaps_previous_asset_id_fkey" FOREIGN KEY ("previous_asset_id") REFERENCES "assets"("id") ON DELETE SET NULL ON UPDATE CASCADE;
