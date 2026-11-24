import { Hono } from 'hono'
import { FormulaError } from '../../shared/expr'
import { defaultPriceFormula, priceExamples, priceFunction } from '../../shared/pricing'
import { assignableRoles, builtInStatuses, type AdminPainting, type Painting, type PaintingLogEntry, type UploadKey } from '../../shared/types'
import { listUsers, requireRole, sha256, type Env } from '../auth'
import { changePaintings } from '../log'
import { getPriceFormula, getPriceFunction, putSetting } from '../settings'
import { connectStripe, disconnectStripe, stripeStatus } from '../stripe'
import { cleanStackName, nextNumberSql, stackIndexSql, topPositionSql } from '../stacks'
import { cleanStatusName, listStatuses, statusExists } from '../statuses'

const admin = new Hono<Env>()
// ---------- for authors too: naming, size, material, status and turn of paintings ----------

admin.use(requireRole('admin', 'author'))

// authors see their own rating only (the price comes from everyone's), and no deleted paintings
admin.get('/paintings', async (c) => {
	const { name, role } = c.get('user')
	const author = role === 'author'
	const { results } = await c.env.DB.prepare(
		`SELECT p.*, ${stackIndexSql}, AVG(r.score) AS rating, COUNT(r.score) AS ratings, MAX(CASE WHEN r.admin = ? THEN r.score END) AS my_score
		 FROM paintings p LEFT JOIN ratings r ON r.painting_id = p.id
		 WHERE ? = 0 OR p.deleted_at IS NULL
		 GROUP BY p.id ORDER BY p.stack, p.position, p.created_at`,
	)
		.bind(name, author ? 1 : 0)
		.all<AdminPainting & { my_score: number | null }>()
	const price = await getPriceFunction(c.env.DB)
	return c.json(
		results.map(({ my_score, ...p }) => ({
			...p,
			price: price(p.width_cm, p.height_cm, p.rating),
			...(author ? { rating: my_score, ratings: my_score === null ? 0 : 1 } : {}),
		})),
	)
})

admin.get('/statuses', async (c) => c.json(await listStatuses(c.env.DB)))

const cleanMaterial = (input: unknown) => (typeof input === 'string' ? input.trim().slice(0, 100) || null : null)

// status or material of many paintings at once (selection on /admin)
admin.patch('/paintings', async (c) => {
	const body = await c.req.json<{ ids: string[]; status?: Painting['status']; material?: string }>()
	const { ids } = body
	if (!Array.isArray(ids) || !ids.length) return c.json({ error: 'no paintings selected' }, 400)
	let change: [string, string | null]
	if ('status' in body) {
		if (!(await statusExists(c.env.DB, body.status))) return c.json({ error: 'invalid status' }, 400)
		change = ['status', body.status!]
	} else if ('material' in body) change = ['material', cleanMaterial(body.material)]
	else return c.json({ error: 'nothing to update' }, 400)
	const [field, value] = change
	await changePaintings(c.env.DB, c.get('user').name, ...ids.map((id) => c.env.DB.prepare(`UPDATE paintings SET ${field} = ? WHERE id = ?`).bind(value, id)))
	return c.json({ ok: true })
})

admin.patch('/paintings/:id', async (c) => {
	const body = await c.req.json<Partial<Pick<Painting, 'title' | 'width_cm' | 'height_cm' | 'status' | 'material'>>>()
	if ('status' in body && !(await statusExists(c.env.DB, body.status))) return c.json({ error: 'invalid status' }, 400)
	if ('material' in body) body.material = cleanMaterial(body.material)
	const fields = (['title', 'width_cm', 'height_cm', 'status', 'material'] as const).filter((f) => f in body)
	if (!fields.length) return c.json({ error: 'nothing to update' }, 400)
	const [{ meta }] = (await changePaintings(
		c.env.DB,
		c.get('user').name,
		c.env.DB.prepare(`UPDATE paintings SET ${fields.map((f) => `${f} = ?`).join(', ')} WHERE id = ?`).bind(...fields.map((f) => body[f] ?? null), c.req.param('id')),
	)) as [D1Result]
	return meta.changes ? c.json({ ok: true }) : c.notFound()
})

// turned by quarter turns (1: clockwise), as metadata: the capture laptop with the painting renders it turned on its next
// sync (capture.ts: /paintings/:id/turned). The size turns along right away
admin.put('/paintings/:id/turn', async (c) => {
	const { by } = await c.req.json<{ by: number }>()
	if (by !== 1 && by !== -1) return c.json({ error: 'turn by 1 or -1' }, 400)
	const [{ meta }] = (await changePaintings(
		c.env.DB,
		c.get('user').name,
		c.env.DB.prepare(`UPDATE paintings SET turn = (turn + ? + 4) % 4, width_cm = height_cm, height_cm = width_cm WHERE id = ? AND deleted_at IS NULL`).bind(by, c.req.param('id')),
	)) as [D1Result]
	return meta.changes ? c.json({ ok: true }) : c.notFound()
})

// ---------- admins only: everything else (stacks, deleting, statuses, price, payments, keys, log) ----------

admin.use(requireRole('admin'))


admin.get('/pricing', async (c) =>
	c.json({ formula: await getPriceFormula(c.env.DB), default: defaultPriceFormula, stripe: await stripeStatus(c.env.DB, c.env) }),
)

// interactive Stripe setup: paste the secret key, the webhook is created at Stripe
admin.put('/stripe', async (c) => {
	const { key } = await c.req.json<{ key: string }>()
	try {
		const note = await connectStripe(c.env.DB, key ?? '', new URL(c.req.url).origin, c.get('user').name)
		return c.json({ ok: true, note })
	} catch (error) {
		return c.json({ error: (error as Error).message }, 400)
	}
})

admin.delete('/stripe', async (c) => {
	await disconnectStripe(c.env.DB)
	return c.json({ ok: true })
})

// validated before saving: must parse and give a price for the examples
admin.put('/pricing', async (c) => {
	const { formula } = await c.req.json<{ formula: string }>()
	try {
		const price = priceFunction(formula)
		if (priceExamples.some((e) => price(e.widthCm, e.heightCm, e.rating) === null))
			return c.json({ error: 'formula gives no positive price for the examples' }, 400)
	} catch (error) {
		if (error instanceof FormulaError) return c.json({ error: error.message }, 400)
		throw error
	}
	await putSetting(c.env.DB, 'price_formula', formula.trim(), c.get('user').name)
	return c.json({ ok: true })
})

// soft delete / restore of many paintings at once
admin.put('/paintings/deleted', async (c) => {
	const { ids, deleted } = await c.req.json<{ ids: string[]; deleted: boolean }>()
	if (!Array.isArray(ids) || !ids.length) return c.json({ error: 'no paintings selected' }, 400)
	// a painting restored while another one has its # by now (they can share one while deleted) goes on top
	const change = deleted
		? `deleted_at = unixepoch()`
		: `deleted_at = NULL, number = CASE
			WHEN EXISTS (SELECT 1 FROM paintings q WHERE q.stack = paintings.stack AND q.number = paintings.number AND q.deleted_at IS NULL AND q.id != paintings.id)
			THEN (SELECT COALESCE(MAX(q.number), -1) + 1 FROM paintings q WHERE q.stack = paintings.stack) ELSE number END`
	const from = deleted ? 'deleted_at IS NULL' : 'deleted_at IS NOT NULL'
	await changePaintings(c.env.DB, c.get('user').name, ...ids.map((id) => c.env.DB.prepare(`UPDATE paintings SET ${change} WHERE id = ? AND ${from}`).bind(id)))
	return c.json({ ok: true })
})

// taken out of / put back into the physical stack: where it was (same position), or on top (one by one in the given order).
// Either way it keeps its #.
// Separate from the status: a sold painting stays in the stack, and has to be found there, until someone gets it.
admin.put('/paintings/taken-out', async (c) => {
	const { ids, out, onTop } = await c.req.json<{ ids: string[]; out: boolean; onTop?: boolean }>()
	if (!Array.isArray(ids) || !ids.length) return c.json({ error: 'no paintings selected' }, 400)
	const change = out
		? `taken_out_at = unixepoch()`
		: onTop
			? `taken_out_at = NULL, position = (SELECT COALESCE(MAX(q.position), -1) + 1 FROM paintings q WHERE q.stack = paintings.stack)`
			: `taken_out_at = NULL`
	// only paintings actually changing sides: one already in its stack keeps its place
	const from = out ? 'taken_out_at IS NULL' : 'taken_out_at IS NOT NULL'
	await changePaintings(c.env.DB, c.get('user').name, ...ids.map((id) => c.env.DB.prepare(`UPDATE paintings SET ${change} WHERE id = ? AND ${from}`).bind(id)))
	return c.json({ ok: true })
})

// to the top of another stack, existing or new: each gets its next # and goes on top. Already there: stays where it is
admin.put('/paintings/stack', async (c) => {
	const { ids, stack: input } = await c.req.json<{ ids: string[]; stack: string }>()
	const stack = cleanStackName(input)
	if (!stack) return c.json({ error: 'invalid stack name' }, 400)
	if (!Array.isArray(ids) || !ids.length) return c.json({ error: 'no paintings selected' }, 400)
	await changePaintings(
		c.env.DB,
		c.get('user').name,
		...ids.map((id) => c.env.DB.prepare(`UPDATE paintings SET stack = ?, number = ${nextNumberSql}, position = ${topPositionSql} WHERE id = ? AND stack IS NOT ?`).bind(stack, stack, stack, id, stack)),
	)
	return c.json({ ok: true })
})

const stackExists = async (db: D1Database, name: string) => !!(await db.prepare(`SELECT 1 FROM paintings WHERE stack = ?`).bind(name).first())
const nameTaken = (name: string) => `there already is a stack called "${name}"`

// A stack's numbers shifted while it may keep its name: moved out of the way below 0 first, as a unique index checks row by row.
const renumber = (db: D1Database, from: string, where: string, args: number[], by: number, to: string) => [
	db.prepare(`UPDATE paintings SET number = -1 - (number + ?) WHERE stack = ? AND number IS NOT NULL ${where}`).bind(by, from, ...args),
	db.prepare(`UPDATE paintings SET number = -1 - number, stack = ? WHERE stack = ? AND number < 0`).bind(to, from),
]

// the name of all its paintings. Stacks are found by their name, so it has to be unambiguous
admin.put('/stacks/rename', async (c) => {
	const body = await c.req.json<{ stack: string; name: string }>()
	const name = cleanStackName(body.name)
	if (!name) return c.json({ error: 'invalid name' }, 400)
	if (name === body.stack) return c.json({ ok: true })
	if (await stackExists(c.env.DB, name)) return c.json({ error: nameTaken(name) }, 400)
	const [{ meta }] = (await changePaintings(c.env.DB, c.get('user').name, c.env.DB.prepare(`UPDATE paintings SET stack = ? WHERE stack = ?`).bind(name, body.stack))) as [D1Result]
	return meta.changes ? c.json({ ok: true }) : c.notFound()
})

// `upper` laid on top of `lower`: its numbers and order continue above the lower ones, gaps and taken-out and deleted
// paintings included
admin.post('/stacks/merge', async (c) => {
	const body = await c.req.json<{ lower: string; upper: string; name: string }>()
	const name = cleanStackName(body.name)
	if (!name) return c.json({ error: 'invalid name' }, 400)
	if (body.lower === body.upper) return c.json({ error: 'pick two different stacks' }, 400)
	if (name !== body.lower && name !== body.upper && (await stackExists(c.env.DB, name))) return c.json({ error: nameTaken(name) }, 400)
	const { top, topPosition } = (await c.env.DB.prepare(`SELECT MAX(number) AS top, MAX(position) AS topPosition FROM paintings WHERE stack = ?`)
		.bind(body.lower)
		.first<{ top: number | null; topPosition: number | null }>())!
	if (top === null || !(await stackExists(c.env.DB, body.upper))) return c.notFound()
	const { bottom } = (await c.env.DB.prepare(`SELECT MIN(position) AS bottom FROM paintings WHERE stack = ?`).bind(body.upper).first<{ bottom: number }>())!
	await changePaintings(
		c.env.DB,
		c.get('user').name,
		c.env.DB.prepare(`UPDATE paintings SET position = position + ? WHERE stack = ?`).bind((topPosition ?? -1) + 1 - bottom, body.upper),
		...renumber(c.env.DB, body.upper, '', [], top + 1, name),
		c.env.DB.prepare(`UPDATE paintings SET stack = ? WHERE stack = ?`).bind(name, body.lower),
	)
	return c.json({ ok: true })
})

// the painting # `at` and everything above it (in the stack's order) become `upper`, numbered from 0; the rest becomes
// `lower` and keeps its numbers. Taken-out and deleted paintings go by their position too
admin.post('/stacks/split', async (c) => {
	const body = await c.req.json<{ stack: string; at: number; lower: string; upper: string }>()
	const [lower, upper] = [cleanStackName(body.lower), cleanStackName(body.upper)]
	if (!lower || !upper || !Number.isInteger(body.at)) return c.json({ error: 'invalid names or position' }, 400)
	if (lower === upper) return c.json({ error: 'the two stacks need different names' }, 400)
	for (const name of [lower, upper]) if (name !== body.stack && (await stackExists(c.env.DB, name))) return c.json({ error: nameTaken(name) }, 400)
	const at = await c.env.DB.prepare(`SELECT position FROM paintings WHERE stack = ? AND number = ? ORDER BY deleted_at IS NOT NULL LIMIT 1`)
		.bind(body.stack, body.at)
		.first<{ position: number }>()
	if (!at) return c.json({ error: `there is no #${body.at} in "${body.stack}"` }, 400)
	const below = await c.env.DB.prepare(`SELECT 1 FROM paintings WHERE stack = ? AND position < ?`).bind(body.stack, at.position).first()
	const { start } = (await c.env.DB.prepare(`SELECT MIN(number) AS start FROM paintings WHERE stack = ? AND position >= ?`).bind(body.stack, at.position).first<{ start: number }>())!
	if (!below) return c.json({ error: 'both parts need a painting' }, 400)
	await changePaintings(
		c.env.DB,
		c.get('user').name,
		c.env.DB.prepare(`UPDATE paintings SET stack = ? WHERE stack = ? AND position < ?`).bind(lower, body.stack, at.position),
		...renumber(c.env.DB, body.stack, 'AND position >= ?', [at.position], -start, upper),
	)
	return c.json({ ok: true })
})

// a new order of the paintings in a stack (taken-out and deleted ones aside), bottom first: they take on the positions they
// had between them, in that order. The others keep theirs, so a taken-out painting still goes back between the same ones.
// Refused if the stack has changed meanwhile.
admin.put('/stacks/order', async (c) => {
	const { stack, ids } = await c.req.json<{ stack: string; ids: string[] }>()
	const { results } = await c.env.DB.prepare(`SELECT id, position FROM paintings WHERE stack = ? AND taken_out_at IS NULL AND deleted_at IS NULL ORDER BY position`)
		.bind(stack)
		.all<{ id: string; position: number }>()
	const current = new Map(results.map((p) => [p.id, p.position]))
	if (!Array.isArray(ids) || ids.length !== current.size || new Set(ids).size !== ids.length || !ids.every((id) => current.has(id)))
		return c.json({ error: 'the stack has changed meanwhile, please reorder again' }, 409)
	const changes = ids.flatMap((id, i) =>
		current.get(id) === results[i]!.position ? [] : [c.env.DB.prepare(`UPDATE paintings SET position = ? WHERE id = ?`).bind(results[i]!.position, id)],
	)
	if (changes.length) await changePaintings(c.env.DB, c.get('user').name, ...changes)
	return c.json({ ok: true })
})

// ---------- statuses ----------

// a new one, listed last
admin.post('/statuses', async (c) => {
	const body = await c.req.json<{ name: string; public: boolean }>()
	const name = cleanStatusName(body.name)
	if (!name) return c.json({ error: 'invalid name' }, 400)
	if (await statusExists(c.env.DB, name)) return c.json({ error: `there already is a status "${name}"` }, 400)
	await c.env.DB.prepare(`INSERT INTO statuses (name, public, position) VALUES (?, ?, (SELECT COALESCE(MAX(position), -1) + 1 FROM statuses))`)
		.bind(name, body.public ? 1 : 0)
		.run()
	return c.json({ ok: true }, 201)
})

// public or not, and the name: renaming carries all its paintings along (logged per painting). Built-in ones keep their name
admin.patch('/statuses/:name', async (c) => {
	const old = c.req.param('name')
	const body = await c.req.json<{ public?: boolean; name?: string }>()
	if (!(await statusExists(c.env.DB, old))) return c.notFound()
	if (typeof body.public === 'boolean') await c.env.DB.prepare(`UPDATE statuses SET public = ? WHERE name = ?`).bind(body.public ? 1 : 0, old).run()
	if (body.name !== undefined && body.name !== old) {
		const name = cleanStatusName(body.name)
		if (!name) return c.json({ error: 'invalid name' }, 400)
		if (builtInStatuses.includes(old)) return c.json({ error: `"${old}" is built in and keeps its name` }, 400)
		if (await statusExists(c.env.DB, name)) return c.json({ error: `there already is a status "${name}"` }, 400)
		await changePaintings(
			c.env.DB,
			c.get('user').name,
			c.env.DB.prepare(`UPDATE statuses SET name = ? WHERE name = ?`).bind(name, old),
			c.env.DB.prepare(`UPDATE paintings SET status = ? WHERE status = ?`).bind(name, old),
		)
	}
	return c.json({ ok: true })
})

// only once no painting has it (deleted ones included), so none is left with an unknown status
admin.delete('/statuses/:name', async (c) => {
	const name = c.req.param('name')
	if (builtInStatuses.includes(name)) return c.json({ error: `"${name}" is built in and can't be removed` }, 400)
	const { count } = (await c.env.DB.prepare(`SELECT COUNT(*) AS count FROM paintings WHERE status = ?`).bind(name).first<{ count: number }>())!
	if (count) return c.json({ error: `${count} painting(s) still have "${name}": give them another status first` }, 400)
	await c.env.DB.prepare(`DELETE FROM statuses WHERE name = ?`).bind(name).run()
	return c.json({ ok: true })
})

// the latest changes, with the painting as it is now
admin.get('/log', async (c) => {
	const { results } = await c.env.DB.prepare(
		`SELECT l.*, p.title, p.stack, p.number FROM painting_log l LEFT JOIN paintings p ON p.id = l.painting_id ORDER BY l.id DESC LIMIT 2000`,
	).all<PaintingLogEntry>()
	return c.json(results)
})

admin.get('/users', async (c) => c.json(await listUsers(c.env)))

// author ↔ rater only: making someone admin or taking it away goes through `pnpm user:role` (scripts/users.ts)
admin.put('/users/:name/role', async (c) => {
	const { role } = await c.req.json<{ role: string }>()
	if (!(assignableRoles as readonly string[]).includes(role)) return c.json({ error: 'admin rights only via pnpm user:role' }, 400)
	const user = await c.env.DB.prepare(`SELECT role FROM users WHERE name = ?`).bind(c.req.param('name')).first<{ role: string }>()
	if (!user) return c.json({ error: 'not in the users table (yet)' }, 404)
	if (user.role === 'admin') return c.json({ error: 'admin rights only via pnpm user:role' }, 400)
	await c.env.DB.prepare(`UPDATE users SET role = ? WHERE name = ?`).bind(role, c.req.param('name')).run()
	return c.json({ ok: true })
})

admin.get('/keys', async (c) => {
	const { results } = await c.env.DB.prepare(
		`SELECT id, name, created_by, created_at, last_used_at FROM upload_keys ORDER BY created_at`,
	).all<UploadKey>()
	return c.json(results)
})

// the key itself is returned once and only its hash is stored
admin.post('/keys', async (c) => {
	const { name } = await c.req.json<{ name: string }>()
	if (!name?.trim()) return c.json({ error: 'name required' }, 400)
	const bytes = crypto.getRandomValues(new Uint8Array(24))
	const key = 'ach_' + btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
	const id = crypto.randomUUID()
	await c.env.DB.prepare(`INSERT INTO upload_keys (id, name, hash, created_by) VALUES (?, ?, ?, ?)`)
		.bind(id, name.trim(), await sha256(key), c.get('user').name)
		.run()
	return c.json({ id, name: name.trim(), key }, 201)
})

admin.delete('/keys/:id', async (c) => {
	await c.env.DB.prepare(`DELETE FROM upload_keys WHERE id = ?`).bind(c.req.param('id')).run()
	return c.json({ ok: true })
})

export default admin
