-- Viewing staff relations: store ids; keep companions / mini_staff as display cache
ALTER TABLE viewings
  ADD COLUMN companion_staff_ids_json JSON NULL AFTER companions,
  ADD COLUMN mini_staff_id VARCHAR(32) NULL AFTER mini_staff;
