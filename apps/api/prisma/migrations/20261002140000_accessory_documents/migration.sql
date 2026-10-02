-- Invoices and warranty papers can hang off an accessory, as they do off an asset.
ALTER TABLE "documents" ADD COLUMN "accessory_id" UUID;

-- CreateIndex
CREATE INDEX "documents_accessory_id_idx" ON "documents"("accessory_id");

-- AddForeignKey
ALTER TABLE "documents" ADD CONSTRAINT "documents_accessory_id_fkey" FOREIGN KEY ("accessory_id") REFERENCES "accessories"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
