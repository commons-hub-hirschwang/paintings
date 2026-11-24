-- Migration number: 0015 	 2026-11-24T14:15:37.192Z
-- website users (server/auth.ts). Added with `pnpm user:add` (scripts/users.ts); users still in the legacy USERS secret move
-- here when they log in and choose a new password. password_hash: see shared/password.ts. role: admin | author | rater.
-- must_change: logged in with a one-time password from the script, a new one has to be chosen first.
CREATE TABLE users (
	name TEXT PRIMARY KEY,
	password_hash TEXT NOT NULL,
	role TEXT NOT NULL DEFAULT 'rater',
	must_change INTEGER NOT NULL DEFAULT 0,
	created_at INTEGER NOT NULL DEFAULT (unixepoch())
);
