-- Public read-only property share links (H5 gallery for non-miniapp viewers).
CREATE TABLE IF NOT EXISTS property_share_tokens (
  token VARCHAR(64) NOT NULL PRIMARY KEY,
  property_code VARCHAR(32) NOT NULL,
  created_by_staff_id VARCHAR(32) NULL,
  expires_at DATETIME NOT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  KEY idx_property_share_expires (expires_at),
  KEY idx_property_share_code (property_code)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
