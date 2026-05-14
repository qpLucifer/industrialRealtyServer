-- Prune denormalized columns from `properties` (derived from admin_full_form_json + audit_hint in app code).
-- Run once on existing DBs after deploying the matching server version.
-- If a column was already dropped, skip that line or run statements one-by-one.

ALTER TABLE properties DROP COLUMN audit_tag;
ALTER TABLE properties DROP COLUMN status_tone;
ALTER TABLE properties DROP COLUMN draft_hint;
ALTER TABLE properties DROP COLUMN audit_key;
ALTER TABLE properties DROP COLUMN audit_badge;
ALTER TABLE properties DROP COLUMN detail_title;
ALTER TABLE properties DROP COLUMN spec_line;
ALTER TABLE properties DROP COLUMN price_line_detail;
ALTER TABLE properties DROP COLUMN lease_chip;
ALTER TABLE properties DROP COLUMN nav_addr;
ALTER TABLE properties DROP COLUMN detail_kv_json;
