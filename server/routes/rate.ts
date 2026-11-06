// Aesthetic ratings 1–10 by admins, authors and raters (size is applied separately in pricing).
// Authors and admins also name paintings here.
import { Hono } from 'hono'
import type { RatePainting } from '../../shared/types'
import { requireRole, type Env } from '../auth'

const rate = new Hono<Env>()
rate.use(requireRole('admin', 'author', 'rater'))

// all paintings with images (drafts too: rating happens before publishing)
rate.get('/paintings', async (c) => {
	const { results } = await c.env.DB.prepare(
		`SELECT p.*, g.name AS group_name, r.score AS my_score
		 FROM paintings p LEFT JOIN ratings r ON r.painting_id = p.id AND r.admin = ?
		 LEFT JOIN painting_groups g ON g.id = p.group_id
		 WHERE p.deleted_at IS NULL AND p.variants_version IS NOT NULL ORDER BY p.created_at`,
	)
		.bind(c.get('user').name)
		.all<RatePainting>()
	return c.json(results)
})

rate.put('/paintings/:id', async (c) => {
	const { score } = await c.req.json<{ score: number }>()
	if (!Number.isInteger(score) || score < 1 || score > 10) return c.json({ error: 'score must be 1–10' }, 400)
	await c.env.DB.prepare(
		`INSERT INTO ratings (painting_id, admin, score) VALUES (?, ?, ?)
		 ON CONFLICT (painting_id, admin) DO UPDATE SET score = excluded.score, updated_at = unixepoch()`,
	)
		.bind(c.req.param('id'), c.get('user').name, score)
		.run()
	return c.json({ ok: true })
})

// exactly one name per painting; empty = "Untitled"
rate.put('/paintings/:id/title', requireRole('admin', 'author'), async (c) => {
	const { title } = await c.req.json<{ title: string }>()
	if (typeof title !== 'string' || title.length > 200) return c.json({ error: 'invalid name' }, 400)
	const { meta } = await c.env.DB.prepare(`UPDATE paintings SET title = ? WHERE id = ?`).bind(title.trim(), c.req.param('id')).run()
	return meta.changes ? c.json({ ok: true }) : c.notFound()
})

export default rate
