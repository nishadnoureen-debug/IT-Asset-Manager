-- HR and IT countersign the forms again: put their boxes back at the front of a saved
-- "Approved by" list (the list stays editable in Settings -> Forms).
UPDATE "settings"
SET "value" =
  (
    CASE
      WHEN NOT EXISTS (
        SELECT 1 FROM jsonb_array_elements("value") AS e
        WHERE lower(e->>'title') IN ('hr department', 'hr')
      )
      THEN '[{"title": "HR Department", "name": ""}]'::jsonb
      ELSE '[]'::jsonb
    END
  )
  ||
  (
    CASE
      WHEN NOT EXISTS (
        SELECT 1 FROM jsonb_array_elements("value") AS e
        WHERE lower(e->>'title') IN ('it department', 'it support', 'it')
      )
      THEN '[{"title": "IT Department", "name": ""}]'::jsonb
      ELSE '[]'::jsonb
    END
  )
  || "value"
WHERE "key" = 'formSignatories' AND jsonb_typeof("value") = 'array';
