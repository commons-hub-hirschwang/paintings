-- Migration number: 0006 	 2026-11-06T09:06:15.110Z
-- groups (stacks) get a stable id and a name that can change: renaming touches one row and survives every sync.
-- Existing groups were identified by their letter: the id is derived from it, as capture laptops convert their local
-- files the same way, offline (legacyGroupId in bridge/project.ts)
CREATE TABLE painting_groups (
	id TEXT PRIMARY KEY,
	name TEXT NOT NULL,
	updated_by TEXT,
	updated_at INTEGER NOT NULL DEFAULT (unixepoch())
);
INSERT INTO painting_groups (id, name)
	SELECT DISTINCT '00000000-0000-0000-0000-' || substr('000000000000' || lower(hex(group_name)), -12), group_name
	FROM paintings WHERE group_name IS NOT NULL;
ALTER TABLE paintings ADD COLUMN group_id TEXT REFERENCES painting_groups (id);
UPDATE paintings SET group_id = '00000000-0000-0000-0000-' || substr('000000000000' || lower(hex(group_name)), -12)
	WHERE group_name IS NOT NULL;
ALTER TABLE paintings DROP COLUMN group_name;
