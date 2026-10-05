-- Asset tags and accessory codes carry a three-digit number (AST-007, ACC-012-03).
-- Existing records keep their number and lose the extra padding; anything past 999 stays as it is.
UPDATE "assets"
   SET "asset_tag" = split_part("asset_tag", '-', 1)
                  || '-'
                  || lpad(ltrim(split_part("asset_tag", '-', 2), '0'), 3, '0')
 WHERE "asset_tag" ~ '^[A-Za-z0-9]+-[0-9]{4,}$';

UPDATE "accessories"
   SET "code" = split_part("code", '-', 1)
             || '-'
             || lpad(ltrim(split_part("code", '-', 2), '0'), 3, '0')
 WHERE "code" ~ '^[A-Za-z0-9]+-[0-9]{4,}$';

-- Every piece is renumbered from its accessory's code, so the labels agree.
UPDATE "accessory_units" u
   SET "code" = a."code" || '-' || lpad(u."number"::text, 2, '0')
  FROM "accessories" a
 WHERE a."id" = u."accessory_id"
   AND u."code" <> a."code" || '-' || lpad(u."number"::text, 2, '0');
