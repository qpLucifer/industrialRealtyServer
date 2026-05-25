-- Industrial land sale / auction listings for admin + mini stats module.
-- Run: mysql ... < scripts/migrations/20260520_industrial_land_auctions.sql

CREATE TABLE IF NOT EXISTS industrial_land_auctions (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  title VARCHAR(255) NOT NULL COMMENT '地块/项目名称',
  region VARCHAR(128) NULL COMMENT '所在区域',
  area_mu DECIMAL(12, 2) NULL COMMENT '面积（亩）',
  start_price_wan DECIMAL(14, 2) NULL COMMENT '起拍价（万元）',
  deal_price_wan DECIMAL(14, 2) NULL COMMENT '成交价（万元，已成交时填写）',
  auction_status VARCHAR(32) NOT NULL DEFAULT 'upcoming'
    COMMENT 'upcoming=即将挂拍 auctioning=正在拍卖 completed=已成交',
  listing_date DATE NULL COMMENT '预计挂拍日期',
  auction_start_at DATETIME NULL COMMENT '拍卖开始时间',
  auction_end_at DATETIME NULL COMMENT '拍卖结束时间',
  completed_at DATETIME NULL COMMENT '成交时间',
  remark TEXT NULL,
  published TINYINT(1) NOT NULL DEFAULT 1 COMMENT '1=小程序可见',
  sort_order INT NOT NULL DEFAULT 0,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  KEY idx_land_auction_status (auction_status, published, sort_order),
  KEY idx_land_auction_listing (listing_date)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

INSERT INTO industrial_land_auctions
  (title, region, area_mu, start_price_wan, deal_price_wan, auction_status, listing_date, auction_start_at, auction_end_at, completed_at, remark, published, sort_order)
VALUES
  ('余杭未来科技城工业用地 A 块', '余杭区', 42.50, 2800.00, NULL, 'upcoming', '2026-06-15', NULL, NULL, NULL, '规划工业用地，临近高速出入口', 1, 30),
  ('萧山经济技术开发区 B 地块', '萧山区', 68.00, 4500.00, NULL, 'upcoming', '2026-06-22', NULL, NULL, NULL, '标准厂房用地，双电源配套', 1, 20),
  ('临平智造小镇 C 地块', '临平区', 35.20, 1900.00, NULL, 'auctioning', NULL, '2026-05-18 10:00:00', '2026-05-25 16:00:00', NULL, '正在阿里拍卖平台进行', 1, 10),
  ('钱塘新区 D 工业用地', '钱塘区', 55.80, 3600.00, 4120.00, 'completed', NULL, NULL, NULL, '2026-04-28 15:30:00', '公开竞价成交', 1, 5);
