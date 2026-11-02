import { Hono } from 'hono'
import { paintingStatuses, type AdminPainting, type Painting, type UploadKey } from '../../shared/types'
import { requireRole, sha256, type Env } from '../auth'

const admin = new Hono<Env>()
admin.use(requireRole('admin'))

admin.get('/paintings', async (c) => {
	const { results } = await c.env.DB.prepare(
		`SELECT p.*, AVG(r.score) AS rating, COUNT(r.score) AS ratings
		 FROM paintings p LEFT JOIN ratings r ON r.painting_id = p.id
		 GROUP BY p.id ORDER BY p.created_at`,
	).all<AdminPainting>()
	return c.json(results)
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
