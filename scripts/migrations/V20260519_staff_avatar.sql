-- Staff WeChat profile for mini-program login echo in admin
ALTER TABLE staff
  ADD COLUMN avatar_url VARCHAR(512) NULL COMMENT 'Mini-program avatar OSS URL' AFTER title;
