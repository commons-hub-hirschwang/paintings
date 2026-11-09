// Stripe REST (no SDK) and its configuration. Set up interactively on /admin (Price & payments): the secret key is
// stored in D1 (settings), and connecting creates the webhook at Stripe, whose signing secret is stored too.
// STRIPE_SECRET_KEY / STRIPE_WEBHOOK_SECRET (wrangler secrets, .dev.vars) still work as a fallback.
import type { StripeStatus } from '../shared/types'
import type { Bindings } from './auth'
import { getSetting, putSetting, deleteSettings } from './settings'

export const webhookEvents = ['checkout.session.completed', 'checkout.session.expired']
export const webhookPath = '/api/stripe/webhook'

export async function stripeApi<T = Record<string, unknown>>(
	key: string,
	method: 'GET' | 'POST' | 'DELETE',
	path: string,
	params: Record<string, string | number> = {},
): Promise<T> {
	const body = new URLSearchParams(Object.entries(params).map(([k, v]) => [k, String(v)]))
	const response = await fetch(`https://api.stripe.com/v1/${path}${method === 'GET' && body.size ? `?${body}` : ''}`, {
		method,
		headers: { authorization: `Bearer ${key}`, 'content-type': 'application/x-www-form-urlencoded' },
		body: method === 'POST' ? body : undefined,
	})
	const json = (await response.json()) as T & { error?: { message: string } }
	if (!response.ok) throw new Error(json.error?.message ?? `stripe ${response.status}`)
	return json
}

export type StripeConfig = { key: string; webhookSecret: string; source: 'admin' | 'secret' }

export async function getStripe(db: D1Database, env: Bindings): Promise<StripeConfig | null> {
	const key = await getSetting(db, 'stripe_secret_key')
	// locally the webhook comes from `stripe listen`, whose secret is in .dev.vars
	if (key) return { key, webhookSecret: (await getSetting(db, 'stripe_webhook_secret')) ?? env.STRIPE_WEBHOOK_SECRET ?? '', source: 'admin' }
	if (env.STRIPE_SECRET_KEY) return { key: env.STRIPE_SECRET_KEY, webhookSecret: env.STRIPE_WEBHOOK_SECRET ?? '', source: 'secret' }
	return null
}

export async function stripeStatus(db: D1Database, env: Bindings): Promise<StripeStatus> {
	const config = await getStripe(db, env)
	return {
		connected: !!config,
		source: config?.source ?? null,
		mode: config ? (config.key.includes('_live_') ? 'live' : 'test') : null,
		account: await getSetting(db, 'stripe_account'),
		webhook: !!config?.webhookSecret,
		webhookUrl: await getSetting(db, 'stripe_webhook_url'),
	}
}

type Account = { id: string; email?: string; business_profile?: { name?: string }; settings?: { dashboard?: { display_name?: string } } }
type WebhookEndpoint = { id: string; url: string; secret?: string }

// checks the key, replaces any webhook of ours for this site at Stripe, stores everything. Returns a note when the
// webhook could not be created (e.g. on localhost, which Stripe can't reach: use `stripe listen` there)
export async function connectStripe(db: D1Database, key: string, origin: string, user: string): Promise<string | null> {
	key = key.trim()
	if (!/^(sk|rk)_(test|live)_/.test(key)) throw new Error('expected a secret key: sk_test_… or sk_live_…')
	const account = await stripeApi<Account>(key, 'GET', 'account')
	const label = account.settings?.dashboard?.display_name || account.business_profile?.name || account.email || account.id

	await disconnectStripe(db, { keepSettings: true })
	await putSetting(db, 'stripe_secret_key', key, user)
	await putSetting(db, 'stripe_account', label, user)

	const url = origin + webhookPath
	if (/^http:\/\/(localhost|127\.|\[::1\])/.test(origin)) return 'webhook not created: Stripe cannot reach localhost (use `stripe listen` and STRIPE_WEBHOOK_SECRET in .dev.vars)'
	// an endpoint for this URL from an earlier setup: its secret is not readable anymore, so replace it
	const { data } = await stripeApi<{ data: WebhookEndpoint[] }>(key, 'GET', 'webhook_endpoints', { limit: 100 })
	for (const old of data.filter((e) => e.url === url)) await stripeApi(key, 'DELETE', `webhook_endpoints/${old.id}`)
	const params: Record<string, string> = { url, description: 'Gallery: paintings sold / reservations expired' }
	webhookEvents.forEach((event, i) => (params[`enabled_events[${i}]`] = event))
	const endpoint = await stripeApi<WebhookEndpoint>(key, 'POST', 'webhook_endpoints', params)
	await putSetting(db, 'stripe_webhook_secret', endpoint.secret!, user)
	await putSetting(db, 'stripe_webhook_id', endpoint.id, user)
	await putSetting(db, 'stripe_webhook_url', url, user)
	return null
}

// removes our webhook at Stripe (best effort) and the stored configuration
export async function disconnectStripe(db: D1Database, { keepSettings = false } = {}) {
	const key = await getSetting(db, 'stripe_secret_key')
	const webhookId = await getSetting(db, 'stripe_webhook_id')
	if (key && webhookId) await stripeApi(key, 'DELETE', `webhook_endpoints/${webhookId}`).catch(() => {})
	await deleteSettings(db, ['stripe_webhook_secret', 'stripe_webhook_id', 'stripe_webhook_url', ...(keepSettings ? [] : ['stripe_secret_key', 'stripe_account'])])
}
