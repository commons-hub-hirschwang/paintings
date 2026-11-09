-- Migration number: 0010 	 2026-11-09
-- the painting's average colour ("#rrggbb", from its thumb, set by the capture laptop with the web images): the wall it
-- hangs on in the gallery, shown before its image has loaded. NULL: not measured yet (the browser measures it then)
ALTER TABLE paintings ADD COLUMN color TEXT;
