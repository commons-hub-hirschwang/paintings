-- Migration number: 0007 	 2026-11-07T04:06:06.098Z
-- "groups" are called what they are: stacks.
-- stack_order (was: number) only sorts, it never changes and may have gaps. A painting's stack index, its position in the
-- physical stack, is counted from it: the paintings before it that are still there (server/stacks.ts, bridge/store.ts).
-- taken_out_at: set = no longer in its stack (sold and picked up, lent, …). The paintings after it move up by themselves;
-- the laptop syncing stack_order can't undo that, and putting a painting back restores its old place.
ALTER TABLE painting_groups RENAME TO stacks;
ALTER TABLE paintings RENAME COLUMN group_id TO stack_id;
ALTER TABLE paintings RENAME COLUMN number TO stack_order;
ALTER TABLE paintings ADD COLUMN taken_out_at INTEGER;
