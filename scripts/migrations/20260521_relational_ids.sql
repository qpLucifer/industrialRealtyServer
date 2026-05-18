-- Store relational links by stable ids (region_defs.id, staff.id, properties.id)
-- Denormalized name columns remain for list display / search.

ALTER TABLE properties
  ADD COLUMN district_region_id INT NULL AFTER district,
  ADD COLUMN submitter_staff_id VARCHAR(32) NULL AFTER submitter_name,
  ADD KEY idx_properties_district_region (district_region_id),
  ADD KEY idx_properties_submitter_staff (submitter_staff_id);

ALTER TABLE customers
  ADD COLUMN owner_staff_ids_json JSON NULL AFTER owner_name;

ALTER TABLE viewings
  ADD COLUMN property_id VARCHAR(32) NULL AFTER property_ref,
  ADD KEY idx_viewings_property (property_id);

-- Backfill from legacy name / code fields (safe to re-run)
UPDATE properties p
INNER JOIN region_defs r ON p.district = r.name
SET p.district_region_id = r.id
WHERE p.district_region_id IS NULL AND p.district <> '' AND p.district <> '未分区';

UPDATE properties p
INNER JOIN staff s ON p.submitter_name = s.name
SET p.submitter_staff_id = s.id
WHERE p.submitter_staff_id IS NULL AND TRIM(IFNULL(p.submitter_name, '')) <> '';

UPDATE viewings v
INNER JOIN properties p ON v.mini_prop_code = p.code OR v.property_ref = p.code
SET v.property_id = p.id
WHERE v.property_id IS NULL;

UPDATE viewings v
INNER JOIN properties p ON v.property_ref = p.id
SET v.property_id = p.id
WHERE v.property_id IS NULL;
