-- Migration number: 0014 	 2026-11-20T18:11:14.462Z
-- a turn of the painting asked for on /admin, in quarter turns clockwise (0–3), still to be done: the capture laptop that has
-- the painting renders it turned on its next sync and takes it back from here. Width and height are swapped right away.
ALTER TABLE paintings ADD COLUMN turn INTEGER NOT NULL DEFAULT 0;
