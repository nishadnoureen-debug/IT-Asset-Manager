-- The company works in UAE dirhams: AED replaces USD as the default currency.
ALTER TABLE "purchases" ALTER COLUMN "currency" SET DEFAULT 'AED';

-- Amounts recorded under the previous USD default were entered in dirhams; relabel them.
UPDATE "assets" SET "currency" = 'AED' WHERE "currency" = 'USD';
UPDATE "purchases" SET "currency" = 'AED' WHERE "currency" = 'USD';
UPDATE "accessories" SET "currency" = 'AED' WHERE "currency" = 'USD';
UPDATE "maintenance" SET "currency" = 'AED' WHERE "currency" = 'USD';
UPDATE "software_licenses" SET "currency" = 'AED' WHERE "currency" = 'USD';
UPDATE "settings" SET "value" = '"AED"'::jsonb WHERE "key" = 'defaultCurrency' AND "value" = '"USD"'::jsonb;
