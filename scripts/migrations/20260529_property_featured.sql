-- Featured listing flag (主推) for 待售 properties — visible in admin + mini lists.
-- Run: mysql ... < scripts/migrations/20260529_property_featured.sql

ALTER TABLE properties
  ADD COLUMN featured TINYINT(1) NOT NULL DEFAULT 0 COMMENT '主推（仅待售有效）' AFTER status_tag,
  ADD KEY idx_properties_featured (featured, status_tag);
