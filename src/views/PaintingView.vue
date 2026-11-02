<script setup lang="ts">
import { ref } from 'vue'
import { RouterLink, useRoute } from 'vue-router'
import { fetchPainting, formatPrice, imageUrl, type PublicPainting } from '@/api'

const route = useRoute()
const painting = ref<PublicPainting | null | undefined>(undefined)
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
				<p class="muted">{{ painting.width_cm }} × {{ painting.height_cm }} cm</p>
				<p v-if="painting.status === 'available'">
					<strong>{{ formatPrice(painting.price) }}</strong>
				</p>
				<p v-else class="muted">{{ painting.status }}</p>
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
