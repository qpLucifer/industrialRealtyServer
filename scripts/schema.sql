-- Industrial realty — schema for admin-web + miniapp-uni
-- Charset
SET NAMES utf8mb4;
SET FOREIGN_KEY_CHECKS = 0;

DROP TABLE IF EXISTS audit_logs;
DROP TABLE IF EXISTS app_messages;
DROP TABLE IF EXISTS announcements;
DROP TABLE IF EXISTS deals;
DROP TABLE IF EXISTS viewings;
DROP TABLE IF EXISTS video_faq;
DROP TABLE IF EXISTS property_activity_logs;
DROP TABLE IF EXISTS customers;
DROP TABLE IF EXISTS properties;
DROP TABLE IF EXISTS region_defs;
DROP TABLE IF EXISTS region_bindings;
DROP TABLE IF EXISTS region_tree_lines;
DROP TABLE IF EXISTS phone_whitelist;
DROP TABLE IF EXISTS staff;
DROP TABLE IF EXISTS sys_users;
DROP TABLE IF EXISTS app_config;
DROP TABLE IF EXISTS security_switches;

SET FOREIGN_KEY_CHECKS = 1;

CREATE TABLE sys_users (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  username VARCHAR(64) NOT NULL UNIQUE,
  password_hash VARCHAR(255) NOT NULL DEFAULT '',
  display_name VARCHAR(128) NOT NULL,
  role_line VARCHAR(255) NOT NULL,
  avatar_url VARCHAR(512) NULL,
  user_kind ENUM('admin', 'staff') NOT NULL DEFAULT 'staff',
  region_line VARCHAR(512) NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE staff (
  id VARCHAR(32) PRIMARY KEY,
  employee_no VARCHAR(32) NOT NULL,
  name VARCHAR(64) NOT NULL,
  phone VARCHAR(32) NULL,
  phone_masked VARCHAR(32) NOT NULL,
  role VARCHAR(32) NOT NULL,
  regions VARCHAR(255) NOT NULL,
  status VARCHAR(32) NOT NULL,
  email VARCHAR(255) NULL,
  department VARCHAR(255) NULL,
  title VARCHAR(128) NULL,
  hire_date VARCHAR(32) NULL,
  account_status VARCHAR(64) NULL,
  region_ids_json JSON NULL,
  data_scope_hint TEXT NULL,
  wecom_user_id VARCHAR(128) NULL,
  open_id_hint VARCHAR(255) NULL,
  remark TEXT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE phone_whitelist (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  phone VARCHAR(32) NOT NULL,
  name VARCHAR(128) NOT NULL,
  remark VARCHAR(255) NOT NULL,
  updated_by VARCHAR(64) NOT NULL,
  updated_at VARCHAR(64) NOT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE region_defs (
  id INT AUTO_INCREMENT PRIMARY KEY,
  name VARCHAR(64) NOT NULL,
  sort_order INT NOT NULL DEFAULT 0,
  UNIQUE KEY uq_region_defs_name (name)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE region_tree_lines (
  id INT AUTO_INCREMENT PRIMARY KEY,
  sort_order INT NOT NULL,
  line_text VARCHAR(255) NOT NULL,
  indent_px INT NOT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE region_bindings (
  id INT AUTO_INCREMENT PRIMARY KEY,
  staff_name VARCHAR(64) NOT NULL,
  node_ids VARCHAR(255) NOT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE properties (
  id VARCHAR(32) PRIMARY KEY,
  code VARCHAR(32) NOT NULL UNIQUE,
  title VARCHAR(255) NOT NULL,
  district VARCHAR(64) NOT NULL,
  type VARCHAR(64) NOT NULL,
  status_tag VARCHAR(32) NOT NULL,
  audit_state VARCHAR(32) NOT NULL,
  listing_line1 VARCHAR(255) NOT NULL,
  listing_line2 VARCHAR(255) NOT NULL,
  submitter_name VARCHAR(64) NOT NULL,
  audit_tag VARCHAR(32) NOT NULL,
  row_muted TINYINT(1) NOT NULL DEFAULT 0,
  meta_line VARCHAR(512) NULL,
  price_line VARCHAR(255) NULL,
  status_tone VARCHAR(32) NULL,
  draft_hint VARCHAR(512) NULL,
  audit_key VARCHAR(32) NULL,
  audit_badge VARCHAR(64) NULL,
  audit_hint TEXT NULL,
  detail_title VARCHAR(255) NULL,
  spec_line VARCHAR(512) NULL,
  price_line_detail VARCHAR(255) NULL,
  lease_chip VARCHAR(64) NULL,
  company VARCHAR(255) NULL,
  addr_kv TEXT NULL,
  map_coord_label VARCHAR(255) NULL,
  nav_addr TEXT NULL,
  detail_kv_json JSON NULL,
  admin_full_form_json JSON NULL,
  submitted_at DATETIME NULL,
  risk_tag VARCHAR(255) NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE property_activity_logs (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  property_code VARCHAR(32) NOT NULL,
  line_text VARCHAR(255) NOT NULL,
  sub_text VARCHAR(255) NOT NULL,
  sort_order INT NOT NULL DEFAULT 0
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE customers (
  slug VARCHAR(64) PRIMARY KEY,
  company VARCHAR(255) NOT NULL,
  contact_name VARCHAR(64) NOT NULL,
  phone VARCHAR(64) NOT NULL,
  phone_masked VARCHAR(64) NOT NULL,
  grade VARCHAR(16) NOT NULL,
  grade_tone VARCHAR(16) NULL,
  title_line VARCHAR(255) NULL,
  recent_text TEXT NULL,
  next_line VARCHAR(255) NULL,
  address_hint VARCHAR(255) NULL,
  demand_summary TEXT NULL,
  deal_status VARCHAR(32) NOT NULL DEFAULT '洽谈中',
  last_follow_at VARCHAR(64) NULL,
  next_reminder VARCHAR(64) NULL,
  owner_name VARCHAR(512) NULL,
  has_next_reminder_tag VARCHAR(16) NULL,
  h2 VARCHAR(255) NULL,
  grade_label VARCHAR(16) NULL,
  reminder_text VARCHAR(255) NULL,
  reminder_tone VARCHAR(16) NULL,
  badges_html VARCHAR(255) NULL,
  last_follow_display VARCHAR(64) NULL,
  detail_kv_json JSON NULL,
  timeline_json JSON NULL,
  follow_grade_value VARCHAR(8) NULL,
  next_follow_input VARCHAR(32) NULL,
  inherit_hint TEXT NULL,
  list_on_mini TINYINT(1) NOT NULL DEFAULT 1,
  admin_id VARCHAR(64) NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE video_faq (
  id VARCHAR(32) PRIMARY KEY,
  keywords VARCHAR(255) NOT NULL,
  question VARCHAR(512) NOT NULL,
  industry VARCHAR(128) NOT NULL,
  video_path VARCHAR(255) NOT NULL,
  tags_json JSON NOT NULL,
  mini_program_search TINYINT(1) NOT NULL DEFAULT 1,
  updated_at VARCHAR(32) NOT NULL,
  summary TEXT NULL,
  meta_line VARCHAR(255) NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE viewings (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  slot_start VARCHAR(64) NOT NULL,
  slot_end VARCHAR(64) NOT NULL,
  property_ref VARCHAR(128) NOT NULL,
  customer_name VARCHAR(128) NOT NULL,
  customer_slug VARCHAR(64) NULL,
  companions VARCHAR(255) NOT NULL,
  score VARCHAR(32) NOT NULL,
  mini_prop_code VARCHAR(32) NULL,
  mini_staff VARCHAR(255) NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE deals (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  contract_type VARCHAR(128) NOT NULL,
  amount VARCHAR(128) NOT NULL,
  commission VARCHAR(128) NOT NULL,
  invoice_type VARCHAR(64) NOT NULL,
  archive_status VARCHAR(64) NOT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE announcements (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  title VARCHAR(255) NOT NULL,
  scope VARCHAR(128) NULL,
  popup VARCHAR(32) NULL,
  popup_start_at DATETIME NULL,
  popup_end_at DATETIME NULL,
  status VARCHAR(32) NULL,
  status_tone VARCHAR(16) NULL,
  body_text TEXT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE app_messages (
  id VARCHAR(32) PRIMARY KEY,
  icon VARCHAR(16) NOT NULL,
  icon_tone VARCHAR(16) NOT NULL,
  title VARCHAR(255) NOT NULL,
  hint TEXT NOT NULL,
  time_text VARCHAR(255) NOT NULL,
  nav VARCHAR(64) NULL,
  prop_id VARCHAR(64) NULL,
  customer_id VARCHAR(64) NULL,
  sort_order INT NOT NULL DEFAULT 0
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE audit_logs (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  logged_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  time_text VARCHAR(64) NOT NULL,
  actor VARCHAR(64) NOT NULL,
  object_label VARCHAR(255) NOT NULL,
  action_label VARCHAR(128) NOT NULL,
  detail VARCHAR(512) NOT NULL,
  kind VARCHAR(16) NOT NULL,
  action VARCHAR(16) NOT NULL,
  sort_order INT NOT NULL DEFAULT 0,
  KEY idx_audit_logs_logged_at (logged_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE security_switches (
  k VARCHAR(64) PRIMARY KEY,
  label VARCHAR(255) NOT NULL,
  enabled TINYINT(1) NOT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

INSERT INTO security_switches (k, label, enabled) VALUES
  ('mask_property_contact', '房源联系人脱敏展示', 1),
  ('mask_customer_phone', '客户手机号脱敏展示', 1),
  ('forbid_long_press_copy', '禁止长按复制敏感字段', 1),
  ('audit_publish', '发布前强制审核', 0);

CREATE TABLE app_config (
  k VARCHAR(64) PRIMARY KEY,
  v_json JSON NOT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
