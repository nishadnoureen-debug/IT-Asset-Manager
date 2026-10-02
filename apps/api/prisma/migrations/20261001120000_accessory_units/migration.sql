-- Every physical piece of an accessory gets its own code and QR label.
CREATE TYPE "accessory_unit_status" AS ENUM ('IN_STOCK', 'ASSIGNED', 'DAMAGED', 'RETIRED');

-- CreateTable
CREATE TABLE "accessory_units" (
    "id" UUID NOT NULL,
    "accessory_id" UUID NOT NULL,
    "code" VARCHAR(40) NOT NULL,
    "qr_token" UUID NOT NULL,
    "number" INTEGER NOT NULL,
    "serial_number" VARCHAR(120),
    "status" "accessory_unit_status" NOT NULL DEFAULT 'IN_STOCK',
    "assignment_id" UUID,
    "notes" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "accessory_units_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "accessory_units_code_key" ON "accessory_units"("code");

-- CreateIndex
CREATE UNIQUE INDEX "accessory_units_qr_token_key" ON "accessory_units"("qr_token");

-- CreateIndex
CREATE UNIQUE INDEX "accessory_units_accessory_id_number_key" ON "accessory_units"("accessory_id", "number");

-- CreateIndex
CREATE INDEX "accessory_units_status_idx" ON "accessory_units"("status");

-- CreateIndex
CREATE INDEX "accessory_units_assignment_id_idx" ON "accessory_units"("assignment_id");

-- AddForeignKey
ALTER TABLE "accessory_units" ADD CONSTRAINT "accessory_units_accessory_id_fkey" FOREIGN KEY ("accessory_id") REFERENCES "accessories"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "accessory_units" ADD CONSTRAINT "accessory_units_assignment_id_fkey" FOREIGN KEY ("assignment_id") REFERENCES "accessory_assignments"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- A piece is with someone only while it is assigned.
ALTER TABLE "accessory_units" ADD CONSTRAINT "accessory_units_holder_check" CHECK (
  ("status" = 'ASSIGNED') = ("assignment_id" IS NOT NULL)
);
ALTER TABLE "accessory_units" ADD CONSTRAINT "accessory_units_number_check" CHECK ("number" >= 1);


-- One piece per unit of stock that is already on the books.
INSERT INTO "accessory_units" ("id", "accessory_id", "code", "qr_token", "number", "updated_at")
SELECT gen_random_uuid(),
       a."id",
       a."code" || '-' || lpad(n::text, 2, '0'),
       gen_random_uuid(),
       n,
       CURRENT_TIMESTAMP
  FROM "accessories" a
  CROSS JOIN LATERAL generate_series(1, GREATEST(a."quantity_total", 0)) AS n
 WHERE a."deleted_at" IS NULL;

-- The pieces that are already out are tied to the hand-outs holding them.
WITH slots AS (
  SELECT aa."accessory_id",
         aa."id" AS assignment_id,
         row_number() OVER (PARTITION BY aa."accessory_id" ORDER BY aa."assigned_at", aa."id", g) AS slot
    FROM "accessory_assignments" aa
    CROSS JOIN LATERAL generate_series(1, GREATEST(aa."quantity", 0)) AS g
   WHERE aa."status" = 'ACTIVE'
), pieces AS (
  SELECT u."id",
         u."accessory_id",
         row_number() OVER (PARTITION BY u."accessory_id" ORDER BY u."number") AS slot
    FROM "accessory_units" u
)
UPDATE "accessory_units" au
   SET "status" = 'ASSIGNED', "assignment_id" = slots.assignment_id
  FROM slots
  JOIN pieces ON pieces."accessory_id" = slots."accessory_id" AND pieces.slot = slots.slot
 WHERE au."id" = pieces."id";
