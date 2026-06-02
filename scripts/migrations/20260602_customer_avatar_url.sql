-- Optional customer photo (COS/CDN URL); shown in admin + mini when set.
ALTER TABLE customers
  ADD COLUMN avatar_url VARCHAR(512) NULL COMMENT 'Customer photo URL' AFTER contact_name;
