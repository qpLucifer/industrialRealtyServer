-- Per-staff announcement read state; re-read when announcements.updated_at advances past content_updated_at.
-- Run once against existing DB: mysql ... < scripts/migrations/20260517_announcement_reads.sql

ALTER TABLE announcements
  ADD COLUMN updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
    ON UPDATE CURRENT_TIMESTAMP
    AFTER body_text;

UPDATE announcements SET updated_at = COALESCE(popup_start_at, NOW()) WHERE updated_at IS NULL OR updated_at = '0000-00-00 00:00:00';

CREATE TABLE IF NOT EXISTS announcement_reads (
  staff_id VARCHAR(32) NOT NULL,
  announcement_id BIGINT NOT NULL,
  read_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  content_updated_at DATETIME NOT NULL,
  PRIMARY KEY (staff_id, announcement_id),
  KEY idx_announcement_reads_ann (announcement_id),
  CONSTRAINT fk_announcement_reads_staff FOREIGN KEY (staff_id) REFERENCES staff (id) ON DELETE CASCADE,
  CONSTRAINT fk_announcement_reads_ann FOREIGN KEY (announcement_id) REFERENCES announcements (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
