-- Customer intended region (links to region_defs like properties)
ALTER TABLE customers
  ADD COLUMN district VARCHAR(64) NOT NULL DEFAULT '' AFTER address_hint,
  ADD COLUMN district_region_id INT NULL AFTER district,
  ADD KEY idx_customers_district_region (district_region_id);
