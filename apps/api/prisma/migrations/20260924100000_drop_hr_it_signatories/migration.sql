-- IT approves the request in the system, and HR does not countersign the forms, so those boxes are
-- dropped from a saved "Verified by" list. The list stays editable in Settings -> Forms.
UPDATE "settings"
SET "value" = (
  SELECT COALESCE(jsonb_agg(entry), '[]'::jsonb)
  FROM jsonb_array_elements("value") AS entry
  WHERE lower(entry->>'title') NOT IN ('hr department', 'hr', 'it support', 'it department', 'it')
)
WHERE "key" = 'formSignatories' AND jsonb_typeof("value") = 'array';
