-- Structured follow-up payload (note, images, audio, occurredAt) for property activity logs.
ALTER TABLE property_activity_logs
  ADD COLUMN entry_json TEXT NULL AFTER sub_text;
