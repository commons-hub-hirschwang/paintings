// Used by capture laptops (bridge sync, pnpm images:regen) with an upload key.
import { Hono } from 'hono'
import { imageKey, isWebVariant, type Variant } from '../../shared/image-variants'
import type { Painting } from '../../shared/types'
import { requireUploadKey, type Env } from '../auth'

const capture = new Hono<Env>()
capture.use(requireUploadKey)

const variantParam = (name: string): Variant | null => (name === 'archive' || name === 'original' || isWebVariant(name) ? name : null)

capture.get('/me', (c) => c.json({ key: c.get('uploadKey') }))

capture.get('/paintings', async (c) => {
	const { results } = await c.env.DB.prepare(`SELECT id, title, variants_version FROM paintings ORDER BY created_at`).all<Painting>()
	return c.json(results)
})

// what only the gallery knows, for the capture tool: current stack names ({ "<id>": "Keller" }) and the paintings that no
// longer count in a stack
capture.get('/stacks', async (c) => {
	const [stacks, out] = await c.env.DB.batch<{ id: string; name: string }>([
		c.env.DB.prepare(`SELECT id, name FROM stacks`),
		c.env.DB.prepare(`SELECT id FROM paintings WHERE taken_out_at IS NOT NULL OR deleted_at IS NOT NULL`),
	])
	return c.json({ names: Object.fromEntries(stacks!.results.map((s) => [s.id, s.name])), out: out!.results.map((p) => p.id) })
})

// stacks created on the laptop. Like titles, the name only counts on first upload: after that /admin owns it
capture.put('/stacks', async (c) => {
	const stacks = await c.req.json<{ id: string; name: string }[]>()
	if (!Array.isArray(stacks) || stacks.some((s) => !s.id || !s.name)) return c.json({ error: 'invalid stacks' }, 400)
	if (stacks.length)
		await c.env.DB.batch(
			stacks.map((s) => c.env.DB.prepare(`INSERT INTO stacks (id, name) VALUES (?, ?) ON CONFLICT (id) DO NOTHING`).bind(s.id, s.name)),
		)
	return c.json({ ok: true })
})

// id comes from the offline capture store; re-posting the same id updates it, so sync retries are safe.
// The title is only set on insert: names edited on the website win over the capture title.
capture.post('/paintings', async (c) => {
	const body = await c.req.json<{
		id: string
		title?: string
		width_cm?: number
		height_cm?: number
		stack_id?: string
		stack_order?: number
		material?: string
	}>()
	if (!body.id) return c.json({ error: 'id required' }, 400)
	await c.env.DB.prepare(
		`INSERT INTO paintings (id, title, width_cm, height_cm, stack_id, stack_order, material) VALUES (?, ?, ?, ?, ?, ?, ?)
		 ON CONFLICT (id) DO UPDATE SET width_cm = excluded.width_cm, height_cm = excluded.height_cm,
			stack_id = excluded.stack_id, stack_order = excluded.stack_order,
			material = COALESCE(excluded.material, paintings.material)`,
	)
		.bind(
			body.id,
			body.title ?? '',
			body.width_cm ?? null,
			body.height_cm ?? null,
			body.stack_id ?? null,
			body.stack_order ?? null,
			body.material || null,
		)
		.run()
	return c.json({ id: body.id }, 201)
})

capture.put('/paintings/:id/variants-version', async (c) => {
	const { variants_version } = await c.req.json<{ variants_version: string }>()
	const { meta } = await c.env.DB.prepare(`UPDATE paintings SET variants_version = ? WHERE id = ?`)
		.bind(variants_version, c.req.param('id'))
		.run()
	return meta.changes ? c.json({ ok: true }) : c.notFound()
})

capture.put('/paintings/:id/images/:variant', async (c) => {
	const variant = variantParam(c.req.param('variant'))
	if (!variant) return c.notFound()
	await c.env.IMAGES.put(imageKey(c.req.param('id'), variant), await c.req.arrayBuffer(), {
		httpMetadata: { contentType: 'image/jpeg' },
	})
	return c.json({ ok: true })
})

capture.get('/paintings/:id/images/:variant', async (c) => {
	const variant = variantParam(c.req.param('variant'))
	if (!variant) return c.notFound()
	const object = await c.env.IMAGES.get(imageKey(c.req.param('id'), variant))
	if (!object) return c.notFound()
	return new Response(object.body, { headers: { 'content-type': 'image/jpeg' } })
})

export default capture
