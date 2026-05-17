-- Customer pool labels for CRM (公有 / 私有) — code dictionary type customer_pool
INSERT IGNORE INTO code_master (type_code, item_code, label, sort_order, is_active) VALUES
  ('customer_pool', 'private', '私有', 10, 1),
  ('customer_pool', 'public', '公有', 20, 1);
