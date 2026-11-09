import { Hono } from 'hono'
import { FormulaError } from '../../shared/expr'
import { defaultPriceFormula, priceExamples, priceFunction } from '../../shared/pricing'
import { paintingStatuses, type AdminPainting, type Painting, type PaintingLogEntry, type UploadKey } from '../../shared/types'
import { requireRole, sha256, type Env } from '../auth'
import { changePaintings } from '../log'
import { getPriceFormula, getPriceFunction, putSetting } from '../settings'
import { connectStripe, disconnectStripe, stripeStatus } from '../stripe'
import { cleanStackName, nextNumberSql, stackIndexSql } from '../stacks'

const admin = new Hono<Env>()
admin.use(requireRole('admin'))

admin.get('/paintings', async (c) => {
	const { results } = await c.env.DB.prepare(
		`SELECT p.*, ${stackIndexSql}, AVG(r.score) AS rating, COUNT(r.score) AS ratings
		 FROM paintings p LEFT JOIN ratings r ON r.painting_id = p.id
		 GROUP BY p.id ORDER BY p.stack, p.number, p.created_at`,
	).all<AdminPainting>()
	const price = await getPriceFunction(c.env.DB)
	return c.json(results.map((p) => ({ ...p, price: price(p.width_cm, p.height_cm, p.rating) })))
})

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

// status of many paintings at once (selection on /admin)
admin.patch('/paintings', async (c) => {
	const { ids, status } = await c.req.json<{ ids: string[]; status: Painting['status'] }>()
	if (!paintingStatuses.includes(status)) return c.json({ error: 'invalid status' }, 400)
	if (!Array.isArray(ids) || !ids.length) return c.json({ error: 'no paintings selected' }, 400)
	await changePaintings(c.env.DB, c.get('user').name, ...ids.map((id) => c.env.DB.prepare(`UPDATE paintings SET status = ? WHERE id = ?`).bind(status, id)))
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

// taken out of / put back into the physical stack: where it was (same #), or on top (next #, one by one in the given order).
// Separate from the status: a sold painting stays in the stack, and has to be found there, until someone gets it.
admin.put('/paintings/taken-out', async (c) => {
	const { ids, out, onTop } = await c.req.json<{ ids: string[]; out: boolean; onTop?: boolean }>()
	if (!Array.isArray(ids) || !ids.length) return c.json({ error: 'no paintings selected' }, 400)
	const change = out
		? `taken_out_at = unixepoch()`
		: onTop
			? `taken_out_at = NULL, number = (SELECT COALESCE(MAX(q.number), -1) + 1 FROM paintings q WHERE q.stack = paintings.stack)`
			: `taken_out_at = NULL`
	// only paintings actually changing sides: one already in its stack keeps its place
	const from = out ? 'taken_out_at IS NULL' : 'taken_out_at IS NOT NULL'
	await changePaintings(c.env.DB, c.get('user').name, ...ids.map((id) => c.env.DB.prepare(`UPDATE paintings SET ${change} WHERE id = ? AND ${from}`).bind(id)))
	return c.json({ ok: true })
})

// to the top of another stack, existing or new: each gets its next #. Already there: stays where it is
admin.put('/paintings/stack', async (c) => {
	const { ids, stack: input } = await c.req.json<{ ids: string[]; stack: string }>()
	const stack = cleanStackName(input)
	if (!stack) return c.json({ error: 'invalid stack name' }, 400)
	if (!Array.isArray(ids) || !ids.length) return c.json({ error: 'no paintings selected' }, 400)
	await changePaintings(
		c.env.DB,
		c.get('user').name,
		...ids.map((id) => c.env.DB.prepare(`UPDATE paintings SET stack = ?, number = ${nextNumberSql} WHERE id = ? AND stack IS NOT ?`).bind(stack, stack, id, stack)),
	)
	return c.json({ ok: true })
})

admin.patch('/paintings/:id', async (c) => {
	const body = await c.req.json<Partial<Pick<Painting, 'title' | 'width_cm' | 'height_cm' | 'status'>>>()
	if (body.status && !paintingStatuses.includes(body.status)) return c.json({ error: 'invalid status' }, 400)
	const fields = (['title', 'width_cm', 'height_cm', 'status'] as const).filter((f) => f in body)
	if (!fields.length) return c.json({ error: 'nothing to update' }, 400)
	const [{ meta }] = (await changePaintings(
		c.env.DB,
		c.get('user').name,
		c.env.DB.prepare(`UPDATE paintings SET ${fields.map((f) => `${f} = ?`).join(', ')} WHERE id = ?`).bind(...fields.map((f) => body[f] ?? null), c.req.param('id')),
	)) as [D1Result]
	return meta.changes ? c.json({ ok: true }) : c.notFound()
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

// `upper` laid on top of `lower`: its numbers continue above the lower ones, gaps and taken-out and deleted paintings included
admin.post('/stacks/merge', async (c) => {
	const body = await c.req.json<{ lower: string; upper: string; name: string }>()
	const name = cleanStackName(body.name)
	if (!name) return c.json({ error: 'invalid name' }, 400)
	if (body.lower === body.upper) return c.json({ error: 'pick two different stacks' }, 400)
	if (name !== body.lower && name !== body.upper && (await stackExists(c.env.DB, name))) return c.json({ error: nameTaken(name) }, 400)
	const { top } = (await c.env.DB.prepare(`SELECT MAX(number) AS top FROM paintings WHERE stack = ?`).bind(body.lower).first<{ top: number | null }>())!
	if (top === null || !(await stackExists(c.env.DB, body.upper))) return c.notFound()
	await changePaintings(
		c.env.DB,
		c.get('user').name,
		...renumber(c.env.DB, body.upper, '', [], top + 1, name),
		c.env.DB.prepare(`UPDATE paintings SET stack = ? WHERE stack = ?`).bind(name, body.lower),
	)
	return c.json({ ok: true })
})

// `at` and everything above become `upper`, numbered from 0; the rest becomes `lower` and keeps its numbers
admin.post('/stacks/split', async (c) => {
	const body = await c.req.json<{ stack: string; at: number; lower: string; upper: string }>()
	const [lower, upper] = [cleanStackName(body.lower), cleanStackName(body.upper)]
	if (!lower || !upper || !Number.isInteger(body.at)) return c.json({ error: 'invalid names or position' }, 400)
	if (lower === upper) return c.json({ error: 'the two stacks need different names' }, 400)
	for (const name of [lower, upper]) if (name !== body.stack && (await stackExists(c.env.DB, name))) return c.json({ error: nameTaken(name) }, 400)
	const below = await c.env.DB.prepare(`SELECT 1 FROM paintings WHERE stack = ? AND number < ?`).bind(body.stack, body.at).first()
	const start = await c.env.DB.prepare(`SELECT MIN(number) AS start FROM paintings WHERE stack = ? AND number >= ?`).bind(body.stack, body.at).first<{ start: number | null }>()
	if (!below || start?.start === null || start?.start === undefined) return c.json({ error: 'both parts need a painting' }, 400)
	await changePaintings(
		c.env.DB,
		c.get('user').name,
		c.env.DB.prepare(`UPDATE paintings SET stack = ? WHERE stack = ? AND number < ?`).bind(lower, body.stack, body.at),
		...renumber(c.env.DB, body.stack, 'AND number >= ?', [body.at], -start.start, upper),
	)
	return c.json({ ok: true })
})

// the latest changes, with the painting as it is now
admin.get('/log', async (c) => {
	const { results } = await c.env.DB.prepare(
		`SELECT l.*, p.title, p.stack, p.number FROM painting_log l LEFT JOIN paintings p ON p.id = l.painting_id ORDER BY l.id DESC LIMIT 2000`,
	).all<PaintingLogEntry>()
	return c.json(results)
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
