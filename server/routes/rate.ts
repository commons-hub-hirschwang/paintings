// Aesthetic ratings 1–10 by admins and raters (size is applied separately in pricing).
import { Hono } from 'hono'
import type { RatePainting } from '../../shared/types'
import { requireRole, type Env } from '../auth'

const rate = new Hono<Env>()
rate.use(requireRole('admin', 'rater'))

// all paintings with images (drafts too: rating happens before publishing)
rate.get('/paintings', async (c) => {
	const { results } = await c.env.DB.prepare(
		`SELECT p.*, r.score AS my_score
		 FROM paintings p LEFT JOIN ratings r ON r.painting_id = p.id AND r.admin = ?
		 WHERE p.variants_version IS NOT NULL ORDER BY p.created_at`,
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

export default rate
