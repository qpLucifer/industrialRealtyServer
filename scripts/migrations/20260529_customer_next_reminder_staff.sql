-- Mini follow-up subscribe remind: only the staff who set next_reminder (mini app).
ALTER TABLE customers
  ADD COLUMN next_reminder_staff_id VARCHAR(32) NULL COMMENT 'staff who set next_reminder via mini' AFTER next_reminder_at;
