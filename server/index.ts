import { Hono } from 'hono'
import { basicAuth } from 'hono/basic-auth'
import { imageKey, isWebVariant, type Variant } from '../shared/image-variants'

type Bindings = {
	DB: D1Database
	IMAGES: R2Bucket
	// "name:password,name:password" — set with `wrangler secret put ADMINS`, locally in .dev.vars
	ADMINS: string
}
type Admin = { Variables: { admin: string } }

type Painting = {
	id: string
	title: string
	width_cm: number | null
	height_cm: number | null
	status: 'draft' | 'available' | 'reserved' | 'sold'
	variants_version: string | null
	created_at: number
}

const app = new Hono<{ Bindings: Bindings }>()

// ---------- public ----------

app.get('/api/paintings', async (c) => {
	const { results } = await c.env.DB.prepare(
		`SELECT id, title, width_cm, height_cm, status, variants_version FROM paintings
		 WHERE status != 'draft' AND variants_version IS NOT NULL ORDER BY created_at`,
	).all<Painting>()
	return c.json(results)
})

app.get('/api/paintings/:id', async (c) => {
	const painting = await c.env.DB.prepare(
		`SELECT id, title, width_cm, height_cm, status, variants_version FROM paintings
		 WHERE id = ? AND status != 'draft'`,
	)
		.bind(c.req.param('id'))
		.first<Painting>()
	return painting ? c.json(painting) : c.notFound()
})

// web variants only; URLs carry ?v=<variants_version>, so they can be cached forever
app.get('/img/:id/:variant{[a-z]+\\.jpg}', async (c) => {
	const variant = c.req.param('variant').replace(/\.jpg$/, '')
	if (!isWebVariant(variant)) return c.notFound()
	const object = await c.env.IMAGES.get(imageKey(c.req.param('id'), variant))
	if (!object) return c.notFound()
	return new Response(object.body, {
		headers: {
			'content-type': 'image/jpeg',
			'cache-control': 'public, max-age=31536000, immutable',
			etag: object.httpEtag,
		},
	})
})

// ---------- admin ----------

const admin = new Hono<{ Bindings: Bindings } & Admin>()

admin.use(async (c, next) => {
	const admins = new Map(
		(c.env.ADMINS ?? '')
			.split(',')
			.map((entry) => entry.trim().split(':') as [string, string])
			.filter(([name, password]) => name && password),
	)
	return basicAuth({
		realm: 'art.commons-hub.at admin',
		verifyUser: (name, password, c) => {
			const ok = admins.get(name) === password
			if (ok) c.set('admin', name)
			return ok
		},
	})(c, next)
})

admin.get('/me', (c) => c.json({ admin: c.get('admin') }))

admin.get('/paintings', async (c) => {
	const { results } = await c.env.DB.prepare(`SELECT * FROM paintings ORDER BY created_at`).all<Painting>()
	return c.json(results)
})

admin.post('/paintings', async (c) => {
	// id may come from the offline capture store; re-posting the same id updates it (sync retries are safe)
	const body = await c.req.json<{ id?: string; title?: string; width_cm?: number; height_cm?: number }>()
	const id = body.id ?? crypto.randomUUID()
	await c.env.DB.prepare(
		`INSERT INTO paintings (id, title, width_cm, height_cm) VALUES (?, ?, ?, ?)
		 ON CONFLICT (id) DO UPDATE SET title = excluded.title, width_cm = excluded.width_cm, height_cm = excluded.height_cm`,
	)
		.bind(id, body.title ?? '', body.width_cm ?? null, body.height_cm ?? null)
		.run()
	return c.json({ id }, 201)
})

admin.patch('/paintings/:id', async (c) => {
	const body = await c.req.json<Partial<Pick<Painting, 'title' | 'width_cm' | 'height_cm' | 'status' | 'variants_version'>>>()
	const fields = (['title', 'width_cm', 'height_cm', 'status', 'variants_version'] as const).filter((f) => f in body)
	if (!fields.length) return c.json({ error: 'nothing to update' }, 400)
	const { meta } = await c.env.DB.prepare(
		`UPDATE paintings SET ${fields.map((f) => `${f} = ?`).join(', ')} WHERE id = ?`,
	)
		.bind(...fields.map((f) => body[f] ?? null), c.req.param('id'))
		.run()
	return meta.changes ? c.json({ ok: true }) : c.notFound()
})

const variantParam = (name: string): Variant | null => (name === 'archive' || isWebVariant(name) ? name : null)

admin.put('/paintings/:id/images/:variant', async (c) => {
	const variant = variantParam(c.req.param('variant'))
	if (!variant) return c.notFound()
	await c.env.IMAGES.put(imageKey(c.req.param('id'), variant), await c.req.arrayBuffer(), {
		httpMetadata: { contentType: 'image/jpeg' },
	})
	return c.json({ ok: true })
})

admin.get('/paintings/:id/images/:variant', async (c) => {
	const variant = variantParam(c.req.param('variant'))
	if (!variant) return c.notFound()
	const object = await c.env.IMAGES.get(imageKey(c.req.param('id'), variant))
	if (!object) return c.notFound()
	return new Response(object.body, { headers: { 'content-type': 'image/jpeg' } })
})

app.route('/api/admin', admin)

export default app
