-- Backfill countryCode for existing servers where region is a 2-letter ISO code
UPDATE "Server"
SET "countryCode" = UPPER(TRIM(region))
WHERE "countryCode" IS NULL
  AND region IS NOT NULL
  AND LENGTH(TRIM(region)) = 2;
