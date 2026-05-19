CREATE TABLE IF NOT EXISTS mini_message_dismissals (
  staff_id VARCHAR(32) NOT NULL,
  message_id VARCHAR(128) NOT NULL,
  dismissed_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (staff_id, message_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
