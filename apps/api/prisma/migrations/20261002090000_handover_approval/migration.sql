-- A hand-over is countersigned in the app by the manager of the employee's department.
ALTER TABLE "asset_assignments"
  ADD COLUMN "approved_at" TIMESTAMPTZ(6),
  ADD COLUMN "approved_by_id" UUID;

-- AddForeignKey
ALTER TABLE "asset_assignments" ADD CONSTRAINT "asset_assignments_approved_by_id_fkey" FOREIGN KEY ("approved_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- CreateIndex
CREATE INDEX "asset_assignments_approved_at_idx" ON "asset_assignments"("approved_at");
