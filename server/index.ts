import { Hono } from 'hono'
import { imageKey, isWebVariant } from '../shared/image-variants'
import { price } from '../shared/pricing'
import type { PublicPainting } from '../shared/types'
import { currentUser, login, logout, type Env } from './auth'
import admin from './routes/admin'
import capture from './routes/capture'
import rate from './routes/rate'

const app = new Hono<Env>()

// ---------- public ----------

const publicSelect = `SELECT p.id, p.title, p.width_cm, p.height_cm, p.status, p.variants_version, p.created_at,
	(SELECT AVG(score) FROM ratings WHERE painting_id = p.id) AS rating
	FROM paintings p WHERE p.status != 'draft' AND p.variants_version IS NOT NULL`

// price from rating × size (shared/pricing.ts); the rating itself is not published
const withPrice = ({ rating, ...p }: PublicPainting & { rating: number | null }): PublicPainting => ({
	...p,
	price: price(p.width_cm, p.height_cm, rating),
})

app.get('/api/paintings', async (c) => {
	const { results } = await c.env.DB.prepare(`${publicSelect} ORDER BY p.created_at`).all<PublicPainting & { rating: number | null }>()
	return c.json(results.map(withPrice))
})

app.get('/api/paintings/:id', async (c) => {
	const painting = await c.env.DB.prepare(`${publicSelect} AND p.id = ?`)
		.bind(c.req.param('id'))
		.first<PublicPainting & { rating: number | null }>()
	return painting ? c.json(withPrice(painting)) : c.notFound()
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

// ---------- auth ----------

app.post('/api/auth/login', async (c) => {
	const { name, password } = await c.req.json<{ name: string; password: string }>()
	const user = await login(c, name, password)
	return user ? c.json(user) : c.json({ error: 'wrong name or password' }, 401)
})

app.post('/api/auth/logout', (c) => {
	logout(c)
	return c.json({ ok: true })
})

app.get('/api/auth/me', async (c) => c.json(await currentUser(c)))

// ---------- protected ----------

app.route('/api/admin', admin)
app.route('/api/rate', rate)
app.route('/api/capture', capture)

export default app
