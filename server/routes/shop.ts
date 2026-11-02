// Buying via Stripe Checkout (plain REST, no SDK). Secrets: STRIPE_SECRET_KEY, STRIPE_WEBHOOK_SECRET.
// Flow: reserve painting → Checkout session (expires in 30 min) → webhook: completed → sold, expired → available.
import { Hono } from 'hono'
import { shipping, shippingOptions } from '../../shared/shipping'
import type { Painting } from '../../shared/types'
import type { Env } from '../auth'
import { getPriceFunction } from '../settings'

type ShopEnv = Env & { Bindings: Env['Bindings'] & { STRIPE_SECRET_KEY: string; STRIPE_WEBHOOK_SECRET: string } }
const shop = new Hono<ShopEnv>()

async function stripe(key: string, path: string, params: Record<string, string | number>) {
	const response = await fetch(`https://api.stripe.com/v1/${path}`, {
		method: 'POST',
		headers: { authorization: `Bearer ${key}`, 'content-type': 'application/x-www-form-urlencoded' },
		body: new URLSearchParams(Object.entries(params).map(([k, v]) => [k, String(v)])),
	})
	const body = (await response.json()) as { url?: string; error?: { message: string } }
	if (!response.ok) throw new Error(body.error?.message ?? `stripe ${response.status}`)
	return body
}

shop.post('/checkout/:id', async (c) => {
	if (!c.env.STRIPE_SECRET_KEY) return c.json({ error: 'shop not configured yet' }, 503)
	const id = c.req.param('id')
	const painting = await c.env.DB.prepare(
		`SELECT p.*, (SELECT AVG(score) FROM ratings WHERE painting_id = p.id) AS rating FROM paintings p WHERE id = ?`,
	)
		.bind(id)
		.first<Painting & { rating: number | null }>()
	const amount = painting && (await getPriceFunction(c.env.DB))(painting.width_cm, painting.height_cm, painting.rating)
	if (!painting || !amount) return c.json({ error: 'not for sale' }, 404)

	// atomic reservation: only one buyer at a time
	const { meta } = await c.env.DB.prepare(`UPDATE paintings SET status = 'reserved' WHERE id = ? AND status = 'available'`).bind(id).run()
	if (!meta.changes) return c.json({ error: 'this painting is reserved or sold' }, 409)

	const origin = new URL(c.req.url).origin
	const options = shippingOptions(painting.width_cm, painting.height_cm)
	const params: Record<string, string | number> = {
		mode: 'payment',
		'line_items[0][quantity]': 1,
		'line_items[0][price_data][currency]': 'eur',
		'line_items[0][price_data][unit_amount]': amount * 100,
		'line_items[0][price_data][product_data][name]': `${painting.title || 'Untitled'} (${painting.width_cm} × ${painting.height_cm} cm)`,
		'line_items[0][price_data][product_data][images][0]': `${origin}/img/${id}/normal.jpg?v=${painting.variants_version}`,
		'metadata[painting_id]': id,
		'payment_intent_data[metadata][painting_id]': id,
		'phone_number_collection[enabled]': 'true',
		expires_at: Math.floor(Date.now() / 1000) + 31 * 60,
		success_url: `${origin}/p/${id}?bought=1`,
		cancel_url: `${origin}/p/${id}`,
	}
	options.forEach((option, i) => {
		params[`shipping_options[${i}][shipping_rate_data][type]`] = 'fixed_amount'
		params[`shipping_options[${i}][shipping_rate_data][display_name]`] = option.label
		params[`shipping_options[${i}][shipping_rate_data][fixed_amount][amount]`] = option.eur * 100
		params[`shipping_options[${i}][shipping_rate_data][fixed_amount][currency]`] = 'eur'
	})
	shipping.countries.forEach((country, i) => (params[`shipping_address_collection[allowed_countries][${i}]`] = country))

	try {
		const session = await stripe(c.env.STRIPE_SECRET_KEY, 'checkout/sessions', params)
		return c.json({ url: session.url })
	} catch (error) {
		await c.env.DB.prepare(`UPDATE paintings SET status = 'available' WHERE id = ? AND status = 'reserved'`).bind(id).run()
		return c.json({ error: (error as Error).message }, 502)
	}
})

async function verifySignature(payload: string, header: string, secret: string) {
	const parts = Object.fromEntries(header.split(',').map((kv) => kv.split('=') as [string, string]))
	if (!parts.t || !parts.v1 || Math.abs(Date.now() / 1000 - Number(parts.t)) > 300) return false
	const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])
	const mac = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(`${parts.t}.${payload}`))
	const hex = [...new Uint8Array(mac)].map((b) => b.toString(16).padStart(2, '0')).join('')
	return hex === parts.v1
}

// Stripe webhook: events checkout.session.completed and checkout.session.expired
shop.post('/stripe/webhook', async (c) => {
	const payload = await c.req.text()
	if (!(await verifySignature(payload, c.req.header('stripe-signature') ?? '', c.env.STRIPE_WEBHOOK_SECRET ?? '')))
		return c.json({ error: 'invalid signature' }, 400)
	const event = JSON.parse(payload) as { type: string; data: { object: { metadata?: { painting_id?: string } } } }
	const id = event.data.object.metadata?.painting_id
	if (id && event.type === 'checkout.session.completed')
		await c.env.DB.prepare(`UPDATE paintings SET status = 'sold' WHERE id = ?`).bind(id).run()
	if (id && event.type === 'checkout.session.expired')
		await c.env.DB.prepare(`UPDATE paintings SET status = 'available' WHERE id = ? AND status = 'reserved'`).bind(id).run()
	return c.json({ received: true })
})

export default shop
