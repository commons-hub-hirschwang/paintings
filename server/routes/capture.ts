// Used by capture laptops (bridge sync, pnpm images:regen) with an upload key.
import { Hono } from 'hono'
import { imageKey, isWebVariant } from '../../shared/image-variants'
import type { Painting } from '../../shared/types'
import { requireUploadKey, type Env } from '../auth'
import { changePaintings } from '../log'
import { cleanStackName, nextNumberSql } from '../stacks'

const capture = new Hono<Env>()
capture.use(requireUploadKey)

// how a capture laptop shows up in the log
const laptop = (key: string) => `upload key "${key}"`

capture.get('/me', (c) => c.json({ key: c.get('uploadKey') }))

capture.get('/paintings', async (c) => {
	const { results } = await c.env.DB.prepare(`SELECT id, title, variants_version, color FROM paintings ORDER BY created_at`).all<Painting>()
	return c.json(results)
})

// the stacks there are, offered in the capture tool
capture.get('/stacks', async (c) => {
	const { results } = await c.env.DB.prepare(`SELECT DISTINCT stack FROM paintings WHERE stack IS NOT NULL AND deleted_at IS NULL ORDER BY stack`).all<{ stack: string }>()
	return c.json(results.map((p) => p.stack))
})

// A new painting, once: on top of its stack (which exists from then on), with the next #. From here on the gallery owns its
// stack, #, name and material; an id it already has is refused.
capture.post('/uploads', async (c) => {
	const body = await c.req.json<{ id: string; title?: string; width_cm?: number; height_cm?: number; stack: string; material?: string }>()
	const stack = cleanStackName(body.stack)
	if (!body.id || !stack) return c.json({ error: 'id and stack required' }, 400)
	const [{ meta }] = (await changePaintings(
		c.env.DB,
		laptop(c.get('uploadKey')),
		c.env.DB.prepare(
			`INSERT INTO paintings (id, title, width_cm, height_cm, stack, number, material) VALUES (?, ?, ?, ?, ?, ${nextNumberSql}, ?) ON CONFLICT (id) DO NOTHING`,
		).bind(body.id, body.title ?? '', body.width_cm ?? null, body.height_cm ?? null, stack, stack, body.material || null),
	)) as [D1Result]
	return meta.changes ? c.json({ id: body.id }, 201) : c.json({ error: 'this painting was already uploaded' }, 409)
})

// what can change from the laptop later, next to the images: the size, as the corners set it
capture.put('/paintings/:id', async (c) => {
	const { width_cm, height_cm } = await c.req.json<{ width_cm: number; height_cm: number }>()
	if (!(width_cm > 0) || !(height_cm > 0)) return c.json({ error: 'invalid size' }, 400)
	const [{ meta }] = (await changePaintings(
		c.env.DB,
		laptop(c.get('uploadKey')),
		c.env.DB.prepare(`UPDATE paintings SET width_cm = ?, height_cm = ? WHERE id = ?`).bind(width_cm, height_cm, c.req.param('id')),
	)) as [D1Result]
	return meta.changes ? c.json({ ok: true }) : c.notFound()
})

const isColor = (color: unknown): color is string => typeof color === 'string' && /^#[0-9a-f]{6}$/.test(color)

// new web images, with their average colour (laptops from before colours: kept as it was)
capture.put('/paintings/:id/variants-version', async (c) => {
	const { variants_version, color } = await c.req.json<{ variants_version: string; color?: string }>()
	const { meta } = await c.env.DB.prepare(`UPDATE paintings SET variants_version = ?, color = COALESCE(?, color) WHERE id = ?`)
		.bind(variants_version, isColor(color) ? color : null, c.req.param('id'))
		.run()
	return meta.changes ? c.json({ ok: true }) : c.notFound()
})

// the average colour alone, for paintings uploaded before colours were stored (pnpm images:colors)
capture.put('/paintings/:id/color', async (c) => {
	const { color } = await c.req.json<{ color: string }>()
	if (!isColor(color)) return c.json({ error: 'color must be #rrggbb' }, 400)
	const { meta } = await c.env.DB.prepare(`UPDATE paintings SET color = ? WHERE id = ?`).bind(color, c.req.param('id')).run()
	return meta.changes ? c.json({ ok: true }) : c.notFound()
})

capture.put('/paintings/:id/images/:variant', async (c) => {
	const variant = c.req.param('variant')
	if (!isWebVariant(variant)) return c.notFound()
	await c.env.IMAGES.put(imageKey(c.req.param('id'), variant), await c.req.arrayBuffer(), {
		httpMetadata: { contentType: 'image/jpeg' },
	})
	return c.json({ ok: true })
})

export default capture
