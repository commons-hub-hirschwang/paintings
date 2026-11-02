-- Migration number: 0003 	 2026-11-02T21:39:36.353Z
-- groups (= physical stacks) with a number inside the group: "A #0", "A #1", … for finding paintings
ALTER TABLE paintings ADD COLUMN group_name TEXT;
ALTER TABLE paintings ADD COLUMN number INTEGER;

-- editable settings, e.g. the price formula
CREATE TABLE settings (
	key TEXT PRIMARY KEY,
	value TEXT NOT NULL,
	updated_by TEXT,
	updated_at INTEGER NOT NULL DEFAULT (unixepoch())
);
