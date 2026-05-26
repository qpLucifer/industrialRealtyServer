-- Migrate stored media paths/URLs to Tencent CDN prefix.
-- Target CDN (no trailing slash): https://cdn.jiayizhou.top
--
-- Compatible with MySQL 5.7+ (no REGEXP_REPLACE — requires MySQL 8 only).
-- Fixes MySQL 1267: session + user vars use utf8mb4_unicode_ci (same as schema.sql tables).
-- IMPORTANT: set @OLD_OSS_BASE / @OLD_COS_BASE to the exact prefix stored in your DB (copy from PREVIEW).

SET NAMES utf8mb4 COLLATE utf8mb4_unicode_ci;
SET collation_connection = 'utf8mb4_unicode_ci';

-- ============ CONFIG — edit old bases you used in production ============
SET @CDN := 'https://cdn.jiayizhou.top';
SET @OLD_OSS_BASE := 'https://YOUR-BUCKET.oss-cn-hangzhou.aliyuncs.com';
SET @OLD_COS_BASE := 'https://YOUR-BUCKET-1250000000.cos.ap-guangzhou.myqcloud.com';

-- Normalize user vars to table collation (avoids LIKE mix with utf8mb4_general_ci)
SET @CDN := @CDN COLLATE utf8mb4_unicode_ci;
SET @OLD_OSS_BASE := @OLD_OSS_BASE COLLATE utf8mb4_unicode_ci;
SET @OLD_COS_BASE := @OLD_COS_BASE COLLATE utf8mb4_unicode_ci;
SET @CDN_SLASH := CONCAT(TRIM(TRAILING '/' FROM @CDN), '/') COLLATE utf8mb4_unicode_ci;
-- http variant of OSS base (if any row used http://)
SET @OLD_OSS_BASE_HTTP := REPLACE(@OLD_OSS_BASE, 'https://', 'http://') COLLATE utf8mb4_unicode_ci;
SET @OLD_COS_BASE_HTTP := REPLACE(@OLD_COS_BASE, 'https://', 'http://') COLLATE utf8mb4_unicode_ci;

-- ============ PREVIEW (read-only) ============
SELECT 'sys_users.avatar_url' AS src, avatar_url AS sample
FROM sys_users
WHERE avatar_url IS NOT NULL AND TRIM(avatar_url) <> ''
LIMIT 20;

SELECT 'staff.avatar_url' AS src, avatar_url AS sample
FROM staff
WHERE avatar_url IS NOT NULL AND TRIM(avatar_url) <> ''
LIMIT 20;

SELECT 'video_faq.video_path' AS src, video_path AS sample
FROM video_faq
WHERE video_path IS NOT NULL AND TRIM(video_path) <> ''
LIMIT 20;

SELECT id, code,
  LEFT(CAST(admin_full_form_json AS CHAR CHARACTER SET utf8mb4) COLLATE utf8mb4_unicode_ci, 400) AS json_head
FROM properties
WHERE admin_full_form_json IS NOT NULL
  AND (
    CAST(admin_full_form_json AS CHAR CHARACTER SET utf8mb4) COLLATE utf8mb4_unicode_ci LIKE '%http://%'
    OR CAST(admin_full_form_json AS CHAR CHARACTER SET utf8mb4) COLLATE utf8mb4_unicode_ci LIKE '%https://%'
  )
LIMIT 10;

-- ============ MIGRATE ============
START TRANSACTION;

-- ----- 1) sys_users.avatar_url -----
UPDATE sys_users
SET avatar_url = CASE
  WHEN avatar_url IS NULL OR TRIM(avatar_url) = '' THEN avatar_url
  WHEN avatar_url LIKE CONCAT(@CDN, '%') COLLATE utf8mb4_unicode_ci THEN avatar_url
  WHEN @OLD_OSS_BASE <> '' AND avatar_url LIKE CONCAT(@OLD_OSS_BASE, '%') COLLATE utf8mb4_unicode_ci THEN
    CONCAT(@CDN, SUBSTRING(avatar_url, CHAR_LENGTH(@OLD_OSS_BASE) + 1))
  WHEN @OLD_COS_BASE <> '' AND avatar_url LIKE CONCAT(@OLD_COS_BASE, '%') COLLATE utf8mb4_unicode_ci THEN
    CONCAT(@CDN, SUBSTRING(avatar_url, CHAR_LENGTH(@OLD_COS_BASE) + 1))
  WHEN avatar_url REGEXP '^https?://' THEN avatar_url
  ELSE CONCAT(@CDN_SLASH, TRIM(LEADING '/' FROM avatar_url))
END
WHERE avatar_url IS NOT NULL AND TRIM(avatar_url) <> ''
  AND avatar_url NOT LIKE CONCAT(@CDN, '%') COLLATE utf8mb4_unicode_ci;

-- ----- 2) staff.avatar_url -----
UPDATE staff
SET avatar_url = CASE
  WHEN avatar_url IS NULL OR TRIM(avatar_url) = '' THEN avatar_url
  WHEN avatar_url LIKE CONCAT(@CDN, '%') COLLATE utf8mb4_unicode_ci THEN avatar_url
  WHEN @OLD_OSS_BASE <> '' AND avatar_url LIKE CONCAT(@OLD_OSS_BASE, '%') COLLATE utf8mb4_unicode_ci THEN
    CONCAT(@CDN, SUBSTRING(avatar_url, CHAR_LENGTH(@OLD_OSS_BASE) + 1))
  WHEN @OLD_COS_BASE <> '' AND avatar_url LIKE CONCAT(@OLD_COS_BASE, '%') COLLATE utf8mb4_unicode_ci THEN
    CONCAT(@CDN, SUBSTRING(avatar_url, CHAR_LENGTH(@OLD_COS_BASE) + 1))
  WHEN avatar_url REGEXP '^https?://' THEN avatar_url
  ELSE CONCAT(@CDN_SLASH, TRIM(LEADING '/' FROM avatar_url))
END
WHERE avatar_url IS NOT NULL AND TRIM(avatar_url) <> ''
  AND avatar_url NOT LIKE CONCAT(@CDN, '%') COLLATE utf8mb4_unicode_ci;

-- ----- 3) video_faq.video_path -----
UPDATE video_faq
SET video_path = CASE
  WHEN video_path IS NULL OR TRIM(video_path) = '' THEN video_path
  WHEN video_path LIKE CONCAT(@CDN, '%') COLLATE utf8mb4_unicode_ci THEN video_path
  WHEN @OLD_OSS_BASE <> '' AND video_path LIKE CONCAT(@OLD_OSS_BASE, '%') COLLATE utf8mb4_unicode_ci THEN
    CONCAT(@CDN, SUBSTRING(video_path, CHAR_LENGTH(@OLD_OSS_BASE) + 1))
  WHEN @OLD_COS_BASE <> '' AND video_path LIKE CONCAT(@OLD_COS_BASE, '%') COLLATE utf8mb4_unicode_ci THEN
    CONCAT(@CDN, SUBSTRING(video_path, CHAR_LENGTH(@OLD_COS_BASE) + 1))
  WHEN video_path REGEXP '^https?://' THEN video_path
  ELSE CONCAT(@CDN_SLASH, TRIM(LEADING '/' FROM video_path))
END
WHERE video_path IS NOT NULL AND TRIM(video_path) <> ''
  AND video_path NOT LIKE CONCAT(@CDN, '%') COLLATE utf8mb4_unicode_ci;

-- ----- 4) properties.admin_full_form_json (exact REPLACE only — set @OLD_* correctly) -----
UPDATE properties
SET admin_full_form_json = CAST(
  REPLACE(
    CAST(admin_full_form_json AS CHAR CHARACTER SET utf8mb4) COLLATE utf8mb4_unicode_ci,
    @OLD_OSS_BASE,
    @CDN
  ) AS JSON
)
WHERE @OLD_OSS_BASE <> '' AND @OLD_OSS_BASE NOT LIKE '%YOUR-BUCKET%'
  AND admin_full_form_json IS NOT NULL
  AND CAST(admin_full_form_json AS CHAR CHARACTER SET utf8mb4) COLLATE utf8mb4_unicode_ci
    LIKE CONCAT('%', @OLD_OSS_BASE, '%') COLLATE utf8mb4_unicode_ci;

UPDATE properties
SET admin_full_form_json = CAST(
  REPLACE(
    CAST(admin_full_form_json AS CHAR CHARACTER SET utf8mb4) COLLATE utf8mb4_unicode_ci,
    @OLD_OSS_BASE_HTTP,
    @CDN
  ) AS JSON
)
WHERE @OLD_OSS_BASE <> '' AND @OLD_OSS_BASE NOT LIKE '%YOUR-BUCKET%'
  AND @OLD_OSS_BASE_HTTP <> @OLD_OSS_BASE
  AND admin_full_form_json IS NOT NULL
  AND CAST(admin_full_form_json AS CHAR CHARACTER SET utf8mb4) COLLATE utf8mb4_unicode_ci
    LIKE CONCAT('%', @OLD_OSS_BASE_HTTP, '%') COLLATE utf8mb4_unicode_ci;

UPDATE properties
SET admin_full_form_json = CAST(
  REPLACE(
    CAST(admin_full_form_json AS CHAR CHARACTER SET utf8mb4) COLLATE utf8mb4_unicode_ci,
    @OLD_COS_BASE,
    @CDN
  ) AS JSON
)
WHERE @OLD_COS_BASE <> '' AND @OLD_COS_BASE NOT LIKE '%YOUR-BUCKET%'
  AND admin_full_form_json IS NOT NULL
  AND CAST(admin_full_form_json AS CHAR CHARACTER SET utf8mb4) COLLATE utf8mb4_unicode_ci
    LIKE CONCAT('%', @OLD_COS_BASE, '%') COLLATE utf8mb4_unicode_ci;

UPDATE properties
SET admin_full_form_json = CAST(
  REPLACE(
    CAST(admin_full_form_json AS CHAR CHARACTER SET utf8mb4) COLLATE utf8mb4_unicode_ci,
    @OLD_COS_BASE_HTTP,
    @CDN
  ) AS JSON
)
WHERE @OLD_COS_BASE <> '' AND @OLD_COS_BASE NOT LIKE '%YOUR-BUCKET%'
  AND @OLD_COS_BASE_HTTP <> @OLD_COS_BASE
  AND admin_full_form_json IS NOT NULL
  AND CAST(admin_full_form_json AS CHAR CHARACTER SET utf8mb4) COLLATE utf8mb4_unicode_ci
    LIKE CONCAT('%', @OLD_COS_BASE_HTTP, '%') COLLATE utf8mb4_unicode_ci;

-- If you had another bucket/region, duplicate the block above with @OLD_OSS_BASE_2, etc.

-- ----- 5) audit_logs.detail -----
UPDATE audit_logs
SET detail = REPLACE(detail, @OLD_OSS_BASE, @CDN)
WHERE @OLD_OSS_BASE <> ''
  AND detail LIKE CONCAT('%', @OLD_OSS_BASE, '%') COLLATE utf8mb4_unicode_ci;

UPDATE audit_logs
SET detail = REPLACE(detail, @OLD_COS_BASE, @CDN)
WHERE @OLD_COS_BASE <> ''
  AND detail LIKE CONCAT('%', @OLD_COS_BASE, '%') COLLATE utf8mb4_unicode_ci;

-- ============ POST CHECK ============
SELECT 'remaining aliyuncs in properties' AS check_name, COUNT(*) AS cnt
FROM properties
WHERE admin_full_form_json IS NOT NULL
  AND CAST(admin_full_form_json AS CHAR CHARACTER SET utf8mb4) COLLATE utf8mb4_unicode_ci LIKE '%aliyuncs.com%';

SELECT 'remaining myqcloud (non-cdn) in properties' AS check_name, COUNT(*) AS cnt
FROM properties
WHERE admin_full_form_json IS NOT NULL
  AND CAST(admin_full_form_json AS CHAR CHARACTER SET utf8mb4) COLLATE utf8mb4_unicode_ci LIKE '%myqcloud.com%'
  AND CAST(admin_full_form_json AS CHAR CHARACTER SET utf8mb4) COLLATE utf8mb4_unicode_ci
    NOT LIKE CONCAT('%', @CDN, '%') COLLATE utf8mb4_unicode_ci;

SELECT 'video_faq not on cdn' AS check_name, COUNT(*) AS cnt
FROM video_faq
WHERE video_path IS NOT NULL AND TRIM(video_path) <> ''
  AND video_path NOT LIKE CONCAT(@CDN, '%') COLLATE utf8mb4_unicode_ci
  AND video_path REGEXP '^https?://';

-- Rows still containing old hosts (fix @OLD_* and re-run section 4, or add another REPLACE)
SELECT id, code,
  LEFT(CAST(admin_full_form_json AS CHAR CHARACTER SET utf8mb4) COLLATE utf8mb4_unicode_ci, 500) AS json_snippet
FROM properties
WHERE admin_full_form_json IS NOT NULL
  AND (
    CAST(admin_full_form_json AS CHAR CHARACTER SET utf8mb4) COLLATE utf8mb4_unicode_ci LIKE '%aliyuncs.com%'
    OR (
      CAST(admin_full_form_json AS CHAR CHARACTER SET utf8mb4) COLLATE utf8mb4_unicode_ci LIKE '%myqcloud.com%'
      AND CAST(admin_full_form_json AS CHAR CHARACTER SET utf8mb4) COLLATE utf8mb4_unicode_ci
        NOT LIKE CONCAT('%', @CDN, '%') COLLATE utf8mb4_unicode_ci
    )
  )
LIMIT 30;

-- COMMIT;
-- ROLLBACK;
