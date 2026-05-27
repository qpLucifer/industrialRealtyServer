-- Customer creation time for list ordering (reminder first, then newest).
ALTER TABLE customers
  ADD COLUMN created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP AFTER admin_id,
  ADD KEY idx_customers_created_at (created_at);

-- Backfill from slug `cust-{epochMs}` when present.
UPDATE customers
SET created_at = FROM_UNIXTIME(CAST(SUBSTRING(slug, 6) AS UNSIGNED) / 1000)
WHERE slug REGEXP '^cust-[0-9]{10,}$'
  AND CAST(SUBSTRING(slug, 6) AS UNSIGNED) > 0;

-- Backfill from admin_id `c-{epochMs}` when slug did not match.
UPDATE customers
SET created_at = FROM_UNIXTIME(CAST(SUBSTRING(admin_id, 3) AS UNSIGNED) / 1000)
WHERE admin_id REGEXP '^c-[0-9]{10,}$'
  AND CAST(SUBSTRING(admin_id, 3) AS UNSIGNED) > 0
  AND slug NOT REGEXP '^cust-[0-9]{10,}$';
