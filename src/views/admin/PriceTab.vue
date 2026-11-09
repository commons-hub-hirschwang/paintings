<script setup lang="ts">
import { ref } from 'vue'
import { authed } from '@/auth'
import { priceExamples, priceVariables } from '../../../shared/pricing'
import { functions } from '../../../shared/expr'
import { act, changed, eur, formula, preview, pricing } from './state'

// Stripe: paste the secret key; the server checks it and creates the webhook at Stripe
const stripeKey = ref('')
const stripeNote = ref('')
const connecting = ref(false)
async function connectStripe() {
	connecting.value = true
	stripeNote.value = ''
	await act(async () => {
		const { note } = await authed<{ note: string | null }>('/api/admin/stripe', { method: 'PUT', body: JSON.stringify({ key: stripeKey.value }) })
		stripeKey.value = ''
		stripeNote.value = note ?? ''
	})
	connecting.value = false
}
const disconnectStripe = () => act(() => authed('/api/admin/stripe', { method: 'DELETE' }))

const savePricing = () => act(() => authed('/api/admin/pricing', { method: 'PUT', body: JSON.stringify({ formula: formula.value }) }))
</script>

<template>
	<fieldset v-if="pricing.stripe" class="payments">
		<legend>Payments (Stripe)</legend>
		<p v-if="pricing.stripe.connected">
			Connected<template v-if="pricing.stripe.account"> to <strong>{{ pricing.stripe.account }}</strong></template>,
			<strong>{{ pricing.stripe.mode }} mode</strong><template v-if="pricing.stripe.source === 'secret'"> (from the STRIPE_SECRET_KEY secret)</template>.
			Webhook: <strong>{{ pricing.stripe.webhook ? 'set up' : 'missing' }}</strong>
			<span v-if="pricing.stripe.webhookUrl" class="muted">({{ pricing.stripe.webhookUrl }})</span>
			<template v-if="!pricing.stripe.webhook"> – without it, paid paintings are not marked sold.</template>
		</p>
		<p v-else>Not set up: nobody can buy yet.</p>
		<p v-if="stripeNote" class="warning">{{ stripeNote }}</p>
		<p class="muted">
			{{ pricing.stripe.connected ? 'Switch account or mode' : 'Set up' }}: copy the secret key from
			<a href="https://dashboard.stripe.com/apikeys" target="_blank">Stripe → Developers → API keys</a>
			(<a href="https://dashboard.stripe.com/test/apikeys" target="_blank">test mode</a>) and paste it here. The webhook is
			created automatically.
		</p>
		<form class="actions" @submit.prevent="connectStripe">
			<input v-model="stripeKey" type="password" placeholder="sk_live_… or sk_test_…" autocomplete="off" spellcheck="false" />
			<button :disabled="!stripeKey.trim() || connecting">{{ connecting ? 'Connecting…' : 'Connect' }}</button>
			<button v-if="pricing.stripe.source === 'admin'" type="button" :disabled="connecting" @click="disconnectStripe">Disconnect</button>
		</form>
	</fieldset>
	<fieldset class="pricing">
		<legend>Price formula</legend>
		<p class="muted">
			Variables: {{ priceVariables.join(', ') }} (rating = average 1–10). Functions: {{ Object.keys(functions).join(', ') }};
			round(x, 10) rounds to 10 €. Operators + − × / % ^. Result is rounded to whole euros; unrated paintings have no price.
		</p>
		<textarea v-model="formula" rows="2" spellcheck="false"></textarea>
		<p v-if="preview.error" class="error">{{ preview.error }}</p>
		<p v-else>
			<span v-for="e in priceExamples" :key="`${e.widthCm}${e.heightCm}${e.rating}`" class="example">
				{{ e.widthCm }}×{{ e.heightCm }} cm, rated {{ e.rating }}: <strong>{{ eur(preview.price?.(e.widthCm, e.heightCm, e.rating)) }}</strong>
			</span>
		</p>
		<div class="actions">
			<button :disabled="!changed || !!preview.error" @click="savePricing">Save formula</button>
			<button :disabled="formula === pricing.default" @click="formula = pricing.default">Default</button>
			<button :disabled="!changed" @click="formula = pricing.formula">Undo</button>
		</div>
	</fieldset>
</template>
