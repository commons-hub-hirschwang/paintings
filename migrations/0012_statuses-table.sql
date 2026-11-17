-- Migration number: 0012 	 2026-11-17T21:19:45.367Z
-- Statuses are configured on /admin (tab Statuses), no longer in code. public: shown in the gallery. position: the order
-- the admin lists them in. draft, available, reserved and sold have behaviour in code (new uploads, the shop): the server
-- keeps them from being renamed or removed (shared/types.ts: builtInStatuses).
CREATE TABLE statuses (
	name TEXT PRIMARY KEY,
	public INTEGER NOT NULL DEFAULT 0,
	position INTEGER NOT NULL
);
INSERT INTO statuses (name, public, position) VALUES
	('draft', 0, 0),
	('private', 0, 1),
	('different artist', 0, 2),
	('available', 1, 3),
	('reserved', 1, 4),
	('sold', 1, 5);
