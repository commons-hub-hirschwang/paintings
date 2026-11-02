-- Migration number: 0002 	 upload-keys

-- keys for capture laptops (bridge sync, image regeneration); only the SHA-256 hash is stored
CREATE TABLE upload_keys (
	id TEXT PRIMARY KEY,
	name TEXT NOT NULL,
	hash TEXT NOT NULL UNIQUE,
	created_by TEXT NOT NULL,
	created_at INTEGER NOT NULL DEFAULT (unixepoch()),
	last_used_at INTEGER
);
