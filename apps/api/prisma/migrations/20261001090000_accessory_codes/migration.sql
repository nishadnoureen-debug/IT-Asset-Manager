-- Accessories get a stock code and a QR token, so they can carry a printed label like an asset.
CREATE SEQUENCE "accessory_code_seq" START 1;

ALTER TABLE "accessories" ADD COLUMN "code" VARCHAR(32);
ALTER TABLE "accessories" ADD COLUMN "qr_token" UUID;

-- Existing stock keeps its order, oldest first.
WITH numbered AS (
  SELECT "id", nextval('accessory_code_seq') AS seq
  FROM (SELECT "id" FROM "accessories" ORDER BY "created_at", "id") AS ordered
)
UPDATE "accessories" a
   SET "code" = 'ACC-' || lpad(numbered.seq::text, 6, '0'),
       "qr_token" = gen_random_uuid()
  FROM numbered
 WHERE numbered."id" = a."id";

ALTER TABLE "accessories" ALTER COLUMN "code" SET NOT NULL;
ALTER TABLE "accessories" ALTER COLUMN "qr_token" SET NOT NULL;

-- CreateIndex
CREATE UNIQUE INDEX "accessories_code_key" ON "accessories"("code");

-- CreateIndex
CREATE UNIQUE INDEX "accessories_qr_token_key" ON "accessories"("qr_token");
