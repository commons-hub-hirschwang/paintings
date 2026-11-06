-- Migration number: 0005 	 2026-11-05T16:48:30.297Z
-- soft delete: set = deleted (hidden everywhere except the "deleted" filter on /admin); the status is kept for restoring
ALTER TABLE paintings ADD COLUMN deleted_at INTEGER;
