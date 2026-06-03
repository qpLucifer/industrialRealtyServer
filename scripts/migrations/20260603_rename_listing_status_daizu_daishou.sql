-- Rename business listing status: 待租→出租, 待售→出售 (keep 待租售 unchanged).

UPDATE properties SET status_tag = '出租' WHERE status_tag = '待租';
UPDATE properties SET status_tag = '出售' WHERE status_tag = '待售';

UPDATE code_master SET label = '出租'
WHERE type_code IN ('property_status_tag', 'property_listing_status') AND item_code = 'for_rent' AND label = '待租';

UPDATE code_master SET label = '出售'
WHERE type_code IN ('property_status_tag', 'property_listing_status') AND item_code = 'for_sale' AND label = '待售';

-- admin_full_form_json.externalStatus (avoid breaking 待租售)
UPDATE properties
SET admin_full_form_json = REPLACE(
  REPLACE(
    REPLACE(admin_full_form_json, '"externalStatus":"待租售"', '"externalStatus":"__RENT_SALE_BOTH__"'),
    '"externalStatus":"待售"',
    '"externalStatus":"出售"'
  ),
  '"externalStatus":"待租"',
  '"externalStatus":"出租"'
)
WHERE admin_full_form_json LIKE '%"externalStatus":"待租%'
   OR admin_full_form_json LIKE '%"externalStatus":"待售"%';

UPDATE properties
SET admin_full_form_json = REPLACE(admin_full_form_json, '"externalStatus":"__RENT_SALE_BOTH__"', '"externalStatus":"待租售"')
WHERE admin_full_form_json LIKE '%__RENT_SALE_BOTH__%';

UPDATE properties SET listing_line1 = '出租' WHERE listing_line1 = '待租';
UPDATE properties SET listing_line1 = '出售' WHERE listing_line1 = '待售';
