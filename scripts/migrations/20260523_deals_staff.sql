-- Attribute deal records to staff for dashboard / commission tracking
ALTER TABLE deals
  ADD COLUMN staff_id VARCHAR(32) NULL AFTER archive_status,
  ADD COLUMN staff_name VARCHAR(128) NULL AFTER staff_id,
  ADD COLUMN recorded_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP AFTER staff_name,
  ADD KEY idx_deals_staff_recorded (staff_id, recorded_at);
