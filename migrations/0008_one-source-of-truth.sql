-- Migration number: 0008 	 2026-11-07
-- The gallery is the one source of truth for stacks. A stack is just its name, and "#" (number) is assigned here at upload:
-- stack + number identify a painting. taken_out_at is unchanged.
-- SQLite can't drop a column used in a foreign key, so paintings is rebuilt. Dropping it while ratings refers to it would
-- cascade and delete all ratings: ratings moves to the new table first and the old one is dropped first.
CREATE TABLE paintings_new (
	id TEXT PRIMARY KEY,
	title TEXT NOT NULL DEFAULT '',
	width_cm REAL,
	height_cm REAL,
	-- draft: captured, not public yet
	status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'available', 'reserved', 'sold')),
	-- webVariantsVersion the web images were generated with; NULL = not generated yet
	variants_version TEXT,
	created_at INTEGER NOT NULL DEFAULT (unixepoch()),
	stack TEXT,
	number INTEGER,
	material TEXT,
	deleted_at INTEGER,
	taken_out_at INTEGER
);
INSERT INTO paintings_new (id, title, width_cm, height_cm, status, variants_version, created_at, stack, number, material, deleted_at, taken_out_at)
	SELECT p.id, p.title, p.width_cm, p.height_cm, p.status, p.variants_version, p.created_at, s.name, p.stack_order, p.material, p.deleted_at, p.taken_out_at
	FROM paintings p LEFT JOIN stacks s ON s.id = p.stack_id;

CREATE TABLE ratings_new (
	painting_id TEXT NOT NULL REFERENCES paintings_new (id) ON DELETE CASCADE,
	admin TEXT NOT NULL,
	score INTEGER NOT NULL CHECK (score BETWEEN 1 AND 10),
	updated_at INTEGER NOT NULL DEFAULT (unixepoch()),
	PRIMARY KEY (painting_id, admin)
);
INSERT INTO ratings_new (painting_id, admin, score, updated_at) SELECT painting_id, admin, score, updated_at FROM ratings;

DROP TABLE ratings;
DROP TABLE paintings;
DROP TABLE stacks;
ALTER TABLE paintings_new RENAME TO paintings;
ALTER TABLE ratings_new RENAME TO ratings;

-- fails, and with it this migration, if two paintings still in use share a stack and number
CREATE UNIQUE INDEX paintings_stack_number ON paintings (stack, number) WHERE stack IS NOT NULL AND deleted_at IS NULL;
