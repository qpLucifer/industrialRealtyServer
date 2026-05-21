-- Add listing status 待租售 (rent + sale both) for 租售皆可 properties.
INSERT IGNORE INTO code_master (type_code, item_code, label, sort_order, is_active, remark)
VALUES ('property_listing_status', 'for_rent_sale', '待租售', 45, 1, '租售皆可默认对外状态');
