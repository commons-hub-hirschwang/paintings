// Users live in the users table (pnpm user:add, scripts/users.ts). The legacy USERS secret ("name:password[:admin|:author],…",
// no role = rater) still logs in, but has to choose a new password right away, which moves the user into the table.
// So does a user added with a one-time password (must_change). Roles: see shared/types.ts (Role).
// Empty passwords only count with ALLOW_EMPTY_PASSWORDS, which only .dev.vars sets: for local development; there, secret
// users are not made to move.
// Website login sets a signed session cookie; capture laptops use upload keys (Bearer) instead.
import type { Context } from 'hono'
import { deleteCookie, getSignedCookie, setSignedCookie } from 'hono/cookie'
import { createMiddleware } from 'hono/factory'
import { hashPassword, minPasswordLength, verifyPassword } from '../shared/password'
import type { Role, User, UserEntry } from '../shared/types'

export type Bindings = {
	DB: D1Database
	IMAGES: R2Bucket
	// the built pages (assets.binding in wrangler.jsonc)
	ASSETS: Fetcher
	// legacy, see above: `wrangler secret put USERS --env commons`, locally in .dev.vars
	USERS?: string
	ALLOW_EMPTY_PASSWORDS?: string
	STRIPE_SECRET_KEY?: string
	STRIPE_WEBHOOK_SECRET?: string
}
export type Env = { Bindings: Bindings; Variables: { user: User; uploadKey: string } }

const COOKIE = 'session'
const devLogin = (env: Bindings) => env.ALLOW_EMPTY_PASSWORDS === 'true'

function secretUsers(env: Bindings) {
	const map = new Map<string, { password: string; role: Role }>()
	for (const entry of (env.USERS ?? '').split(',')) {
		const [name, password, role] = entry.trim().split(':')
		if (name && (password || devLogin(env))) map.set(name, { password: password ?? '', role: role === 'admin' || role === 'author' ? role : 'rater' })
	}
	return map
}

type Found = { role: Role; mustChange: boolean; matches: (password: string) => Promise<boolean> }

// the table first: a user who moved out of the secret logs in with the new password only
async function findUser(env: Bindings, name: string): Promise<Found | null> {
	const row = await env.DB.prepare(`SELECT password_hash, role, must_change FROM users WHERE name = ?`)
		.bind(name)
		.first<{ password_hash: string; role: Role; must_change: number }>()
	if (row) return { role: row.role, mustChange: !!row.must_change, matches: (password) => verifyPassword(password, row.password_hash) }
	const legacy = secretUsers(env).get(name)
	return legacy ? { role: legacy.role, mustChange: !devLogin(env), matches: async (password) => password === legacy.password } : null
}

// signing key for session cookies: random, made on first use (table settings); deleting it logs everyone out
let sessionKey: string | undefined
async function secret(env: Bindings) {
	if (!sessionKey) {
		const random = [...crypto.getRandomValues(new Uint8Array(32))].map((b) => b.toString(16).padStart(2, '0')).join('')
		await env.DB.prepare(`INSERT OR IGNORE INTO settings (key, value) VALUES ('session_key', ?)`).bind(random).run()
		sessionKey = (await env.DB.prepare(`SELECT value FROM settings WHERE key = 'session_key'`).first<{ value: string }>())!.value
	}
	return sessionKey
}

async function startSession(c: Context<Env>, name: string) {
	await setSignedCookie(c, COOKIE, name, await secret(c.env), {
		httpOnly: true,
		secure: true,
		sameSite: 'Lax',
		path: '/',
		maxAge: 60 * 60 * 24 * 30,
	})
}

// null: wrong name or password; mustChange: right, but a new password has to be chosen first (changePassword), no session yet
export async function login(c: Context<Env>, name: string, password: string): Promise<User | { mustChange: true } | null> {
	const user = await findUser(c.env, name)
	if (!user || !(await user.matches(password))) return null
	if (user.mustChange) return { mustChange: true }
	await startSession(c, name)
	return { name, role: user.role }
}

// with the current password (or the one-time / legacy one): stores the new one in the table and logs in
export async function changePassword(c: Context<Env>, name: string, password: string, newPassword: string): Promise<User | string> {
	const user = await findUser(c.env, name)
	if (!user || !(await user.matches(password))) return 'wrong name or password'
	if (newPassword.length < minPasswordLength) return `the new password needs at least ${minPasswordLength} characters`
	if (newPassword === password) return 'the new password has to be a different one'
	await c.env.DB.prepare(
		`INSERT INTO users (name, password_hash, role) VALUES (?, ?, ?)
		 ON CONFLICT (name) DO UPDATE SET password_hash = excluded.password_hash, must_change = 0`,
	)
		.bind(name, await hashPassword(newPassword), user.role)
		.run()
	await startSession(c, name)
	return { name, role: user.role }
}

// for /admin → Users: the table, then who is still only in the secret
export async function listUsers(env: Bindings): Promise<UserEntry[]> {
	const { results } = await env.DB.prepare(`SELECT name, role, must_change, created_at FROM users ORDER BY name`).all<
		Omit<UserEntry, 'must_change' | 'legacy'> & { must_change: number }
	>()
	const users: UserEntry[] = results.map((u) => ({ ...u, must_change: !!u.must_change, legacy: false }))
	const moved = new Set(users.map((u) => u.name))
	for (const [name, { role }] of secretUsers(env))
		if (!moved.has(name)) users.push({ name, role, must_change: false, legacy: true, created_at: null })
	return users
}

export const logout = (c: Context<Env>) => deleteCookie(c, COOKIE, { path: '/', secure: true })

export async function currentUser(c: Context<Env>): Promise<User | null> {
	const name = await getSignedCookie(c, await secret(c.env), COOKIE)
	const user = name ? await findUser(c.env, name) : null
	return name && user ? { name, role: user.role } : null
}

export const requireRole = (...roles: Role[]) =>
	createMiddleware<Env>(async (c, next) => {
		const user = await currentUser(c)
		// 401 logs out in the browser: only when not logged in at all
		if (!user) return c.json({ error: 'not logged in' }, 401)
		if (!roles.includes(user.role)) return c.json({ error: 'not allowed for your role' }, 403)
		c.set('user', user)
		await next()
	})

export async function sha256(text: string) {
	const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text))
	return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('')
}

export const requireUploadKey = createMiddleware<Env>(async (c, next) => {
	const key = /^Bearer (\S+)$/.exec(c.req.header('authorization') ?? '')?.[1]
	const row = key
		? await c.env.DB.prepare(`SELECT id, name FROM upload_keys WHERE hash = ?`).bind(await sha256(key)).first<{ id: string; name: string }>()
		: null
	if (!row) return c.json({ error: 'missing or invalid upload key' }, 401)
	c.executionCtx.waitUntil(c.env.DB.prepare(`UPDATE upload_keys SET last_used_at = unixepoch() WHERE id = ?`).bind(row.id).run())
	c.set('uploadKey', row.name)
	await next()
})
