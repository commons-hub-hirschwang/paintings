// Users come from the USERS secret: "name:password[:admin|:author],…" — no role = rater.
// Website login sets a signed session cookie; capture laptops use upload keys (Bearer) instead.
import type { Context } from 'hono'
import { deleteCookie, getSignedCookie, setSignedCookie } from 'hono/cookie'
import { createMiddleware } from 'hono/factory'
import type { Role, User } from '../shared/types'

export type Bindings = {
	DB: D1Database
	IMAGES: R2Bucket
	// `wrangler secret put USERS --env commons`, locally in .dev.vars
	USERS: string
}
export type Env = { Bindings: Bindings; Variables: { user: User; uploadKey: string } }

const COOKIE = 'session'

function users(env: Bindings) {
	const map = new Map<string, { password: string; role: Role }>()
	for (const entry of (env.USERS ?? '').split(',')) {
		const [name, password, role] = entry.trim().split(':')
		if (name && password) map.set(name, { password, role: role === 'admin' || role === 'author' ? role : 'rater' })
	}
	return map
}

// the user list doubles as signing key: changing any password logs everyone out
const secret = (env: Bindings) => `session:${env.USERS}`

export async function login(c: Context<Env>, name: string, password: string): Promise<User | null> {
	const user = users(c.env).get(name)
	if (!user || user.password !== password) return null
	await setSignedCookie(c, COOKIE, name, secret(c.env), {
		httpOnly: true,
		secure: true,
		sameSite: 'Lax',
		path: '/',
		maxAge: 60 * 60 * 24 * 30,
	})
	return { name, role: user.role }
}

export const logout = (c: Context<Env>) => deleteCookie(c, COOKIE, { path: '/', secure: true })

export async function currentUser(c: Context<Env>): Promise<User | null> {
	const name = await getSignedCookie(c, secret(c.env), COOKIE)
	const user = name ? users(c.env).get(name) : undefined
	return name && user ? { name, role: user.role } : null
}

export const requireRole = (...roles: Role[]) =>
	createMiddleware<Env>(async (c, next) => {
		const user = await currentUser(c)
		if (!user || !roles.includes(user.role)) return c.json({ error: 'not logged in or not allowed' }, 401)
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
