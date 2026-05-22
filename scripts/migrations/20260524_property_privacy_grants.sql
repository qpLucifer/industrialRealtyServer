-- Per staff × property grant to view privacy fields on mini property detail
CREATE TABLE property_privacy_grants (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  staff_id VARCHAR(32) NOT NULL,
  property_id VARCHAR(32) NOT NULL,
  property_code VARCHAR(32) NOT NULL,
  can_view_privacy TINYINT(1) NOT NULL DEFAULT 0,
  remark VARCHAR(255) NULL,
  updated_by VARCHAR(64) NULL,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_privacy_staff_property (staff_id, property_id),
  KEY idx_privacy_property (property_id),
  KEY idx_privacy_staff (staff_id),
  CONSTRAINT fk_privacy_staff FOREIGN KEY (staff_id) REFERENCES staff (id) ON DELETE CASCADE,
  CONSTRAINT fk_privacy_property FOREIGN KEY (property_id) REFERENCES properties (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
