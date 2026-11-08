<script setup lang="ts">
import { authed } from '@/auth'
import { priceExamples, priceVariables } from '../../../shared/pricing'
import { functions } from '../../../shared/expr'
import { act, changed, eur, formula, preview, pricing } from './state'

const savePricing = () => act(() => authed('/api/admin/pricing', { method: 'PUT', body: JSON.stringify({ formula: formula.value }) }))
</script>

<template>
	<section>
		<h2>Payments</h2>
		<p>
			Stripe: <strong>{{ pricing.stripe ? 'connected' : 'not set up' }}</strong>, webhook: <strong>{{ pricing.webhook ? 'set up' : 'not set up' }}</strong>
		</p>
	</section>
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
