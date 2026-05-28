-- Track scheduled subscribe-message sends (viewing T-30min, follow due day).
ALTER TABLE viewings
  ADD COLUMN subscribe_remind_30m_sent TINYINT NOT NULL DEFAULT 0 COMMENT '1 after 30min-before subscribe sent';

ALTER TABLE customers
  ADD COLUMN follow_subscribe_remind_for_date DATE NULL COMMENT 'next_reminder date already notified via subscribe';
