import { Hono } from 'hono'
import { FormulaError } from '../../shared/expr'
import { defaultPriceFormula, priceExamples, priceFunction } from '../../shared/pricing'
import { paintingStatuses, type AdminPainting, type Painting, type UploadKey } from '../../shared/types'
import { requireRole, sha256, type Env } from '../auth'
import { getPriceFormula, getPriceFunction } from '../settings'

const admin = new Hono<Env>()
admin.use(requireRole('admin'))

admin.get('/paintings', async (c) => {
	const { results } = await c.env.DB.prepare(
		`SELECT p.*, AVG(r.score) AS rating, COUNT(r.score) AS ratings
		 FROM paintings p LEFT JOIN ratings r ON r.painting_id = p.id
		 GROUP BY p.id ORDER BY p.group_name, p.number, p.created_at`,
	).all<AdminPainting>()
	const price = await getPriceFunction(c.env.DB)
	return c.json(results.map((p) => ({ ...p, price: price(p.width_cm, p.height_cm, p.rating) })))
})

admin.get('/pricing', async (c) => c.json({ formula: await getPriceFormula(c.env.DB), default: defaultPriceFormula }))

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
	await c.env.DB.prepare(
		`INSERT INTO settings (key, value, updated_by) VALUES ('price_formula', ?, ?)
		 ON CONFLICT (key) DO UPDATE SET value = excluded.value, updated_by = excluded.updated_by, updated_at = unixepoch()`,
	)
		.bind(formula.trim(), c.get('user').name)
		.run()
	return c.json({ ok: true })
})

admin.patch('/paintings/:id', async (c) => {
	const body = await c.req.json<Partial<Pick<Painting, 'title' | 'width_cm' | 'height_cm' | 'status'>>>()
	if (body.status && !paintingStatuses.includes(body.status)) return c.json({ error: 'invalid status' }, 400)
	const fields = (['title', 'width_cm', 'height_cm', 'status'] as const).filter((f) => f in body)
	if (!fields.length) return c.json({ error: 'nothing to update' }, 400)
	const { meta } = await c.env.DB.prepare(`UPDATE paintings SET ${fields.map((f) => `${f} = ?`).join(', ')} WHERE id = ?`)
		.bind(...fields.map((f) => body[f] ?? null), c.req.param('id'))
		.run()
	return meta.changes ? c.json({ ok: true }) : c.notFound()
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
