-- Migration number: 0013 	 2026-11-19T15:51:34.753Z
-- The order of a stack is explicit: position, lower = further down. Until now it was the # (number), which also identifies
-- a painting and so could never change. Now a stack can be reordered (/admin, Stacks → Reorder) while every painting keeps
-- its #. Positions only sort, may have gaps and repeat across stacks; taken-out paintings keep theirs, so putting one back
-- "where it was" still works. The current order carries over: position = number.
ALTER TABLE paintings ADD COLUMN position INTEGER;
UPDATE paintings SET position = number;

-- the log trigger of 0011, now also logging the position
DROP TRIGGER paintings_log_update;
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
		SELECT NEW.id, (SELECT name FROM current_actor), 'position', OLD.position, NEW.position WHERE OLD.position IS NOT NEW.position;
	INSERT INTO painting_log (painting_id, actor, field, old_value, new_value)
		SELECT NEW.id, (SELECT name FROM current_actor), 'material', OLD.material, NEW.material WHERE OLD.material IS NOT NEW.material;
	INSERT INTO painting_log (painting_id, actor, field, old_value, new_value)
		SELECT NEW.id, (SELECT name FROM current_actor), 'deleted', iif(OLD.deleted_at IS NULL, 'no', 'yes'), iif(NEW.deleted_at IS NULL, 'no', 'yes') WHERE iif(OLD.deleted_at IS NULL, 'no', 'yes') IS NOT iif(NEW.deleted_at IS NULL, 'no', 'yes');
	INSERT INTO painting_log (painting_id, actor, field, old_value, new_value)
		SELECT NEW.id, (SELECT name FROM current_actor), 'taken out', iif(OLD.taken_out_at IS NULL, 'no', 'yes'), iif(NEW.taken_out_at IS NULL, 'no', 'yes') WHERE iif(OLD.taken_out_at IS NULL, 'no', 'yes') IS NOT iif(NEW.taken_out_at IS NULL, 'no', 'yes');
END;

