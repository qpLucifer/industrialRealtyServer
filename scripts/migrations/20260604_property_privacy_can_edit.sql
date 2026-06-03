-- Per staff × property grant: mini edit on live listings (in addition to can_view_privacy)
ALTER TABLE property_privacy_grants
  ADD COLUMN can_edit_property TINYINT(1) NOT NULL DEFAULT 0 AFTER can_view_privacy;
