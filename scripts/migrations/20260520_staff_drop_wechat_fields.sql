-- Remove unused WeChat nickname / OpenId columns from staff (mini avatar_url is kept).
ALTER TABLE staff
  DROP COLUMN wecom_user_id,
  DROP COLUMN open_id_hint;
