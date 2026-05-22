-- Industrial realty — schema for admin-web + miniapp-uni
-- Charset
SET NAMES utf8mb4;
SET FOREIGN_KEY_CHECKS = 0;

DROP TABLE IF EXISTS audit_logs;
DROP TABLE IF EXISTS app_messages;
DROP TABLE IF EXISTS announcement_reads;
DROP TABLE IF EXISTS announcements;
DROP TABLE IF EXISTS code_master;
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
  avatar_url VARCHAR(512) NULL,
  hire_date VARCHAR(32) NULL,
  account_status VARCHAR(64) NULL,
  region_ids_json JSON NULL,
  data_scope_hint TEXT NULL,
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
  district_region_id INT NULL,
  type VARCHAR(64) NOT NULL,
  status_tag VARCHAR(32) NOT NULL,
  audit_state VARCHAR(32) NOT NULL,
  listing_line1 VARCHAR(255) NOT NULL,
  listing_line2 VARCHAR(255) NOT NULL,
  submitter_name VARCHAR(64) NOT NULL,
  submitter_staff_id VARCHAR(32) NULL,
  row_muted TINYINT(1) NOT NULL DEFAULT 0,
  meta_line VARCHAR(512) NULL,
  price_line VARCHAR(255) NULL,
  audit_hint TEXT NULL,
  company VARCHAR(255) NULL,
  addr_kv TEXT NULL,
  map_coord_label VARCHAR(255) NULL,
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
  next_reminder_at DATETIME NULL,
  owner_name VARCHAR(512) NULL,
  owner_staff_ids_json JSON NULL,
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
  property_id VARCHAR(32) NULL,
  customer_name VARCHAR(128) NOT NULL,
  customer_slug VARCHAR(64) NULL,
  companions VARCHAR(255) NOT NULL,
  companion_staff_ids_json JSON NULL,
  score VARCHAR(32) NOT NULL,
  mini_prop_code VARCHAR(32) NULL,
  mini_staff VARCHAR(255) NULL,
  mini_staff_id VARCHAR(32) NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE deals (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  contract_type VARCHAR(128) NOT NULL,
  amount VARCHAR(128) NOT NULL,
  commission VARCHAR(128) NOT NULL,
  invoice_type VARCHAR(64) NOT NULL,
  archive_status VARCHAR(64) NOT NULL,
  staff_id VARCHAR(32) NULL,
  staff_name VARCHAR(128) NULL,
  recorded_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  KEY idx_deals_staff_recorded (staff_id, recorded_at)
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
  body_text TEXT NULL,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE announcement_reads (
  staff_id VARCHAR(32) NOT NULL,
  announcement_id BIGINT NOT NULL,
  read_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  content_updated_at DATETIME NOT NULL,
  PRIMARY KEY (staff_id, announcement_id),
  KEY idx_announcement_reads_ann (announcement_id),
  CONSTRAINT fk_announcement_reads_staff FOREIGN KEY (staff_id) REFERENCES staff (id) ON DELETE CASCADE,
  CONSTRAINT fk_announcement_reads_ann FOREIGN KEY (announcement_id) REFERENCES announcements (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE code_master (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  type_code VARCHAR(64) NOT NULL,
  item_code VARCHAR(64) NOT NULL,
  label VARCHAR(255) NOT NULL,
  sort_order INT NOT NULL DEFAULT 0,
  is_active TINYINT(1) NOT NULL DEFAULT 1,
  remark VARCHAR(255) NULL,
  UNIQUE KEY uk_code_master_type_item (type_code, item_code),
  KEY idx_code_master_type (type_code, is_active, sort_order)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

INSERT INTO code_master (type_code, item_code, label, sort_order, is_active) VALUES
  ('staff_role', 'sales', '业务员', 10, 1),
  ('staff_role', 'dept_mgr', '部门经理', 20, 1),
  ('staff_role', 'super_admin', '超级管理员', 30, 1),
  ('staff_account_status', 'ok', '正常', 10, 1),
  ('staff_account_status', 'disabled_resigned', '禁用（离职）', 20, 1),
  ('staff_account_status', 'frozen_risk', '冻结（风控）', 30, 1),
  ('staff_department', 'hq', '总经办', 10, 1),
  ('staff_department', 'hp1', '黄埔业务一部', 20, 1),
  ('staff_department', 'ns2', '南沙业务二部', 30, 1),
  ('staff_department', 'ops', '运营中心', 40, 1),
  ('staff_department', 'hr', '人事行政', 50, 1),
  ('staff_job_title', 'director', '部门总监', 10, 1),
  ('staff_job_title', 'mgr', '业务经理', 20, 1),
  ('staff_job_title', 'senior_sales', '高级业务员', 30, 1),
  ('staff_job_title', 'sales', '业务员', 40, 1),
  ('staff_job_title', 'hr_staff', '人事专员', 50, 1),
  ('property_type', 'standard', '标准厂房', 10, 1),
  ('property_type', 'standalone', '独门独院厂房', 20, 1),
  ('property_type', 'warehouse', '仓库', 30, 1),
  ('property_type', 'land_ind', '工业用地', 40, 1),
  ('property_type', 'office', '写字楼', 50, 1),
  ('property_type', 'park_shop', '产业园商铺', 60, 1),
  ('property_status_tag', 'draft', '草稿', 10, 1),
  ('property_status_tag', 'pending_audit', '待审核', 20, 1),
  ('property_status_tag', 'rejected', '驳回', 30, 1),
  ('property_status_tag', 'for_rent', '待租', 40, 1),
  ('property_status_tag', 'rented', '已租', 50, 1),
  ('property_status_tag', 'for_sale', '待售', 60, 1),
  ('property_status_tag', 'sold', '已售', 70, 1),
  ('property_status_tag', 'intent', '意向中', 80, 1),
  ('property_status_tag', 'archived', '下架封存', 90, 1),
  ('customer_pool', 'private', '私有', 10, 1),
  ('customer_pool', 'public', '公有', 20, 1),
  ('property_listing_status', 'for_rent', '待租', 10, 1),
  ('property_listing_status', 'rented', '已租', 20, 1),
  ('property_listing_status', 'for_sale', '待售', 30, 1),
  ('property_listing_status', 'sold', '已售', 40, 1),
  ('property_listing_status', 'for_rent_sale', '待租售', 45, 1),
  ('property_listing_status', 'intent', '意向中', 50, 1),
  ('property_listing_status', 'archived', '下架封存', 60, 1);

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

CREATE TABLE property_privacy_grants (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  staff_id VARCHAR(32) NOT NULL,
  property_id VARCHAR(32) NOT NULL,
  property_code VARCHAR(32) NOT NULL,
  can_view_privacy TINYINT(1) NOT NULL DEFAULT 0,
  remark VARCHAR(255) NULL,
  updated_by VARCHAR(64) NULL,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_privacy_staff_property (staff_id, property_id),
  KEY idx_privacy_property (property_id),
  KEY idx_privacy_staff (staff_id),
  CONSTRAINT fk_privacy_staff FOREIGN KEY (staff_id) REFERENCES staff (id) ON DELETE CASCADE,
  CONSTRAINT fk_privacy_property FOREIGN KEY (property_id) REFERENCES properties (id) ON DELETE CASCADE
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
