-- Migration number: 0011 	 2026-11-14
-- Statuses are configured in code (shared/types.ts: statusConfig, each one public or not): the CHECK listing them goes,
-- the server checks a status against the config, so new statuses need no migration.
-- SQLite can't drop a CHECK, so paintings is rebuilt as in 0009: ratings moves along (dropping paintings while ratings
-- refers to it would delete all ratings), and the index and log triggers, which go with the old table, are made again.
CREATE TABLE paintings_new (
	id TEXT PRIMARY KEY,
	title TEXT NOT NULL DEFAULT '',
	width_cm REAL,
	height_cm REAL,
	-- one of statusConfig (shared/types.ts)
	status TEXT NOT NULL DEFAULT 'draft',
	-- webVariantsVersion the web images were generated with; NULL = not generated yet
	variants_version TEXT,
	created_at INTEGER NOT NULL DEFAULT (unixepoch()),
	stack TEXT,
	number INTEGER,
	material TEXT,
	deleted_at INTEGER,
	taken_out_at INTEGER,
	-- average colour "#rrggbb" (0010)
	color TEXT
);
INSERT INTO paintings_new (id, title, width_cm, height_cm, status, variants_version, created_at, stack, number, material, deleted_at, taken_out_at, color)
	SELECT id, title, width_cm, height_cm, status, variants_version, created_at, stack, number, material, deleted_at, taken_out_at, color FROM paintings;

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

-- the log triggers of 0009, unchanged
CREATE TRIGGER paintings_log_insert AFTER INSERT ON paintings BEGIN
	INSERT INTO painting_log (painting_id, actor, field, new_value)
	VALUES (NEW.id, (SELECT name FROM current_actor), 'uploaded', NEW.stack || ' #' || NEW.number);
END;

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

