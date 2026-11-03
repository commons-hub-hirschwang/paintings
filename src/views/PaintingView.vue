<script setup lang="ts">
import { ref } from 'vue'
import { RouterLink, useRoute } from 'vue-router'
import { fetchPainting, formatPrice, imageUrl, type PublicPainting } from '@/api'
import { sizeLabel } from '../../shared/types'

const route = useRoute()
const painting = ref<PublicPainting | null | undefined>(undefined)
const bought = route.query.bought === '1'
const error = ref('')
const buying = ref(false)

async function buy() {
	buying.value = true
	error.value = ''
	const response = await fetch(`/api/checkout/${painting.value!.id}`, { method: 'POST' })
	const body = await response.json()
	if (response.ok) location.href = body.url
	else {
		error.value = body.error
		buying.value = false
	}
}
fetchPainting(String(route.params.id)).then((p) => (painting.value = p))
</script>

<template>
	<main id="painting">
		<RouterLink to="/">← Gallery</RouterLink>
		<p v-if="painting === null" class="muted">Painting not found.</p>
		<template v-else-if="painting">
			<a :href="imageUrl(painting, 'detail')" target="_blank">
				<img :src="imageUrl(painting, 'normal')" :alt="painting.title" />
			</a>
			<aside>
				<h1>{{ painting.title || 'Untitled' }}</h1>
				<p class="muted">{{ sizeLabel(painting) }}</p>
				<p v-if="bought">Thank you for your purchase! We will contact you about pick-up or shipping.</p>
				<template v-else-if="painting.status === 'available' && painting.price">
					<p><strong>{{ formatPrice(painting.price) }}</strong></p>
					<button :disabled="buying" @click="buy">Buy</button>
					<p class="muted">Pick-up in Austria (free) or shipping, chosen at checkout.</p>
				</template>
				<p v-else class="muted">{{ painting.status === 'available' ? formatPrice(null) : painting.status }}</p>
				<p v-if="error" class="error">{{ error }}</p>
			</aside>
		</template>
	</main>
</template>

<style>
#painting {
	display: grid;
	grid-template-columns: 2fr 1fr;
	gap: var(--gap);

	& > a:first-child {
		grid-column: 1 / -1;
	}

	& img {
		display: block;
		max-width: 100%;
		max-height: 85dvh;
	}

	@media (max-width: 40rem) {
		grid-template-columns: 1fr;
	}
}
</style>
