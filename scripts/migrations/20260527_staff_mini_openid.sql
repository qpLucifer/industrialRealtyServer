-- WeChat mini-program openid for subscribe-message delivery.
ALTER TABLE staff
  ADD COLUMN mini_openid VARCHAR(64) NULL COMMENT 'WeChat mini openid' AFTER avatar_url;
