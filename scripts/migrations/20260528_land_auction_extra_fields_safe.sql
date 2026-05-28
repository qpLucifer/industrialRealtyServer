-- Supplement when 20260527 partially failed or table lacks start_price_wan / deal_price_wan.
-- Run line by line; ignore "Duplicate column name" for columns already present.

ALTER TABLE industrial_land_auctions
  ADD COLUMN transfer_term VARCHAR(64) NULL COMMENT '出让年限' AFTER area_mu;

ALTER TABLE industrial_land_auctions
  ADD COLUMN tax_per_mu DECIMAL(14, 4) NULL COMMENT '亩产税' AFTER area_mu;

ALTER TABLE industrial_land_auctions
  ADD COLUMN investment_per_mu DECIMAL(14, 4) NULL COMMENT '亩产投资' AFTER area_mu;

ALTER TABLE industrial_land_auctions
  ADD COLUMN deposit_wan DECIMAL(14, 2) NULL COMMENT '保证金（万元）' AFTER area_mu;

ALTER TABLE industrial_land_auctions
  ADD COLUMN start_price_wan DECIMAL(14, 2) NULL COMMENT '起始价（万元）' AFTER area_mu;

ALTER TABLE industrial_land_auctions
  ADD COLUMN deal_price_wan DECIMAL(14, 2) NULL COMMENT '成交价（万元）' AFTER start_price_wan;

ALTER TABLE industrial_land_auctions
  ADD COLUMN avg_price_per_mu DECIMAL(14, 2) NULL COMMENT '均价（万元/亩）' AFTER deal_price_wan;

ALTER TABLE industrial_land_auctions
  ADD COLUMN buyer_info VARCHAR(512) NULL COMMENT '买方信息' AFTER avg_price_per_mu;

ALTER TABLE industrial_land_auctions
  MODIFY COLUMN start_price_wan DECIMAL(14, 2) NULL COMMENT '起始价（万元）',
  MODIFY COLUMN deal_price_wan DECIMAL(14, 2) NULL COMMENT '成交价（万元）';
