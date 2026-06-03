-- Mini property list sector: sale | rent | both
ALTER TABLE staff
  ADD COLUMN property_sector_scope VARCHAR(16) NOT NULL DEFAULT 'both'
  COMMENT 'sale=出售板块 rent=出租板块 both=均可'
  AFTER region_ids_json;
