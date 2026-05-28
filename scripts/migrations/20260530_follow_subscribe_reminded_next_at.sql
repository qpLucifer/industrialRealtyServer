-- Dedupe follow subscribe by exact next_reminder_at (not calendar day only).
ALTER TABLE customers
  ADD COLUMN follow_subscribe_reminded_next_at DATETIME NULL
    COMMENT 'next_reminder_at value already sent via subscribe'
    AFTER follow_subscribe_remind_for_date;
