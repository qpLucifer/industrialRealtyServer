-- New listing status 待开发 (business status like 待租/待售; 草稿 workflow unchanged)

INSERT INTO code_master (type_code, item_code, label, sort_order, is_active, remark)
VALUES ('property_status_tag', 'pending_dev', '待开发', 35, 1, '房源待开发')
ON DUPLICATE KEY UPDATE label = VALUES(label), sort_order = VALUES(sort_order), is_active = 1;

INSERT INTO code_master (type_code, item_code, label, sort_order, is_active, remark)
VALUES ('property_listing_status', 'pending_dev', '待开发', 8, 1, '对外状态-待开发')
ON DUPLICATE KEY UPDATE label = VALUES(label), sort_order = VALUES(sort_order), is_active = 1;
