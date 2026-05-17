-- Schedulable next follow-up time for workbench reminders and sorting.
ALTER TABLE customers
  ADD COLUMN next_reminder_at DATETIME NULL AFTER next_reminder,
  ADD KEY idx_customers_next_reminder_at (next_reminder_at);

UPDATE customers
SET next_reminder_at = STR_TO_DATE(REPLACE(REPLACE(TRIM(next_follow_input), 'T', ' '), '.000', ''), '%Y-%m-%d %H:%i:%s')
WHERE next_follow_input IS NOT NULL
  AND TRIM(next_follow_input) <> ''
  AND next_follow_input REGEXP '^[0-9]{4}-[0-9]{2}-[0-9]{2}';

UPDATE customers
SET next_reminder_at = STR_TO_DATE(REPLACE(TRIM(next_reminder), 'T', ' '), '%Y-%m-%d %H:%i:%s')
WHERE next_reminder_at IS NULL
  AND next_reminder IS NOT NULL
  AND TRIM(next_reminder) <> ''
  AND next_reminder <> '—'
  AND next_reminder REGEXP '^[0-9]{4}-[0-9]{2}-[0-9]{2}';
