-- Migration number: 0009 	 2026-11-07
-- A status "private": like a draft it isn't public, but it is meant to stay that way.
-- SQLite can't change a CHECK, so paintings is rebuilt, the same safe way as in 0008: ratings moves first, as dropping
-- paintings while ratings refers to it would delete all ratings.
CREATE TABLE paintings_new (
	id TEXT PRIMARY KEY,
	title TEXT NOT NULL DEFAULT '',
	width_cm REAL,
	height_cm REAL,
	-- draft: captured, not public yet; private: not public, on purpose
	status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'private', 'available', 'reserved', 'sold')),
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
	SELECT id, title, width_cm, height_cm, status, variants_version, created_at, stack, number, material, deleted_at, taken_out_at FROM paintings;

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
ALTER TABLE paintings_new RENAME TO paintings;
ALTER TABLE ratings_new RENAME TO ratings;

CREATE UNIQUE INDEX paintings_stack_number ON paintings (stack, number) WHERE stack IS NOT NULL AND deleted_at IS NULL;

-- Who changed what. Triggers write the log, so no route can forget it, and within the same transaction as the change.
-- SQLite has no session to ask who is acting: each batch of changes names them here first and clears it last
-- (server/log.ts). A change made any other way is logged with no actor.
CREATE TABLE current_actor (name TEXT);
INSERT INTO current_actor (name) VALUES (NULL);

CREATE TABLE painting_log (
	id INTEGER PRIMARY KEY,
	painting_id TEXT NOT NULL,
	actor TEXT,
	field TEXT NOT NULL,
	old_value,
	new_value,
	created_at INTEGER NOT NULL DEFAULT (unixepoch())
);

CREATE TRIGGER paintings_log_insert AFTER INSERT ON paintings BEGIN
	INSERT INTO painting_log (painting_id, actor, field, new_value)
	VALUES (NEW.id, (SELECT name FROM current_actor), 'uploaded', NEW.stack || ' #' || NEW.number);
END;

-- Merge and split shift numbers in two steps: to -1 - final, then to final (the unique index checks row by row). The first
-- step is logged as old → final, the second one has nothing left to log.
CREATE TRIGGER paintings_log_update AFTER UPDATE ON paintings BEGIN
	INSERT INTO painting_log (painting_id, actor, field, old_value, new_value)
		SELECT NEW.id, (SELECT name FROM current_actor), 'title', OLD.title, NEW.title WHERE OLD.title IS NOT NEW.title;
	INSERT INTO painting_log (painting_id, actor, field, old_value, new_value)
		SELECT NEW.id, (SELECT name FROM current_actor), 'width_cm', OLD.width_cm, NEW.width_cm WHERE OLD.width_cm IS NOT NEW.width_cm;
	INSERT INTO painting_log (painting_id, actor, field, old_value, new_value)
		SELECT NEW.id, (SELECT name FROM current_actor), 'height_cm', OLD.height_cm, NEW.height_cm WHERE OLD.height_cm IS NOT NEW.height_cm;
	INSERT INTO painting_log (painting_id, actor, field, old_value, new_value)
		SELECT NEW.id, (SELECT name FROM current_actor), 'status', OLD.status, NEW.status WHERE OLD.status IS NOT NEW.status;
	INSERT INTO painting_log (painting_id, actor, field, old_value, new_value)
		SELECT NEW.id, (SELECT name FROM current_actor), 'stack', OLD.stack, NEW.stack WHERE OLD.stack IS NOT NEW.stack;
	INSERT INTO painting_log (painting_id, actor, field, old_value, new_value)
		SELECT NEW.id, (SELECT name FROM current_actor), 'number', CASE WHEN OLD.number < 0 THEN NEW.number ELSE OLD.number END, CASE WHEN NEW.number < 0 THEN -1 - NEW.number ELSE NEW.number END WHERE CASE WHEN OLD.number < 0 THEN NEW.number ELSE OLD.number END IS NOT CASE WHEN NEW.number < 0 THEN -1 - NEW.number ELSE NEW.number END;
	INSERT INTO painting_log (painting_id, actor, field, old_value, new_value)
		SELECT NEW.id, (SELECT name FROM current_actor), 'material', OLD.material, NEW.material WHERE OLD.material IS NOT NEW.material;
	INSERT INTO painting_log (painting_id, actor, field, old_value, new_value)
		SELECT NEW.id, (SELECT name FROM current_actor), 'deleted', iif(OLD.deleted_at IS NULL, 'no', 'yes'), iif(NEW.deleted_at IS NULL, 'no', 'yes') WHERE iif(OLD.deleted_at IS NULL, 'no', 'yes') IS NOT iif(NEW.deleted_at IS NULL, 'no', 'yes');
	INSERT INTO painting_log (painting_id, actor, field, old_value, new_value)
		SELECT NEW.id, (SELECT name FROM current_actor), 'taken out', iif(OLD.taken_out_at IS NULL, 'no', 'yes'), iif(NEW.taken_out_at IS NULL, 'no', 'yes') WHERE iif(OLD.taken_out_at IS NULL, 'no', 'yes') IS NOT iif(NEW.taken_out_at IS NULL, 'no', 'yes');
END;
