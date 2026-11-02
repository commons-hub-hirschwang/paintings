-- Migration number: 0001 	 init

CREATE TABLE paintings (
	id TEXT PRIMARY KEY,
	title TEXT NOT NULL DEFAULT '',
	width_cm REAL,
	height_cm REAL,
	-- draft: captured, not public yet
	status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'available', 'reserved', 'sold')),
	-- webVariantsVersion the web images were generated with; NULL = not generated yet
	variants_version TEXT,
	created_at INTEGER NOT NULL DEFAULT (unixepoch())
);

-- aesthetic rating per admin, 1–10 (size is applied separately in pricing)
CREATE TABLE ratings (
	painting_id TEXT NOT NULL REFERENCES paintings (id) ON DELETE CASCADE,
	admin TEXT NOT NULL,
	score INTEGER NOT NULL CHECK (score BETWEEN 1 AND 10),
	updated_at INTEGER NOT NULL DEFAULT (unixepoch()),
	PRIMARY KEY (painting_id, admin)
);
