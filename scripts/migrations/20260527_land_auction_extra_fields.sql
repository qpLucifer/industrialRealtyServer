-- Industrial land auction: 8 business fields (admin + mini).
-- Run: mysql ... < scripts/migrations/20260527_land_auction_extra_fields.sql
--
-- | # | Column              | 业务名           | 说明                          |
-- |---|---------------------|------------------|-------------------------------|
-- | 1 | transfer_term       | 出让年限         | 新增                          |
-- | 2 | tax_per_mu          | 亩产税           | 新增                          |
-- | 3 | investment_per_mu   | 亩产投资         | 新增                          |
-- | 4 | deposit_wan         | 保证金（万元）   | 新增                          |
-- | 5 | start_price_wan     | 起始价（万元）   | 建表已有，本脚本仅更新注释    |
-- | 6 | deal_price_wan      | 成交价（万元）   | 建表已有，本脚本仅更新注释    |
-- | 7 | avg_price_per_mu    | 均价（万元/亩）  | 新增                          |
-- | 8 | buyer_info          | 买方信息         | 新增                          |

-- Fields 1–4
ALTER TABLE industrial_land_auctions
  ADD COLUMN transfer_term VARCHAR(64) NULL COMMENT '出让年限' AFTER area_mu,
  ADD COLUMN tax_per_mu DECIMAL(14, 4) NULL COMMENT '亩产税' AFTER transfer_term,
  ADD COLUMN investment_per_mu DECIMAL(14, 4) NULL COMMENT '亩产投资' AFTER tax_per_mu,
  ADD COLUMN deposit_wan DECIMAL(14, 2) NULL COMMENT '保证金（万元）' AFTER investment_per_mu;

-- Fields 7–8
ALTER TABLE industrial_land_auctions
  ADD COLUMN avg_price_per_mu DECIMAL(14, 2) NULL COMMENT '均价（万元/亩）' AFTER deal_price_wan,
  ADD COLUMN buyer_info VARCHAR(512) NULL COMMENT '买方信息' AFTER avg_price_per_mu;

-- Fields 5–6 (rename comment from 起拍价 → 起始价)
ALTER TABLE industrial_land_auctions
  MODIFY COLUMN start_price_wan DECIMAL(14, 2) NULL COMMENT '起始价（万元）',
  MODIFY COLUMN deal_price_wan DECIMAL(14, 2) NULL COMMENT '成交价（万元）';
