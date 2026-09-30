-- Two employees can exchange their SIM cards: each line's row points at the other half of the swap.
ALTER TABLE "sim_swaps" ADD COLUMN "paired_swap_id" UUID;

-- CreateIndex
CREATE UNIQUE INDEX "sim_swaps_paired_swap_id_key" ON "sim_swaps"("paired_swap_id");

-- AddForeignKey
ALTER TABLE "sim_swaps" ADD CONSTRAINT "sim_swaps_paired_swap_id_fkey" FOREIGN KEY ("paired_swap_id") REFERENCES "sim_swaps"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- A swap is never paired with itself.
ALTER TABLE "sim_swaps" ADD CONSTRAINT "sim_swaps_paired_check" CHECK ("paired_swap_id" IS NULL OR "paired_swap_id" <> "id");
