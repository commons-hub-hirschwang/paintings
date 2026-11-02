<script setup lang="ts">
import { ref } from 'vue'
import { RouterLink } from 'vue-router'
import { fetchPaintings, formatPrice, imageUrl, type PublicPainting } from '@/api'

const paintings = ref<PublicPainting[]>([])
fetchPaintings().then((list) => (paintings.value = list))
</script>

<template>
	<main id="gallery">
		<p v-if="!paintings.length" class="muted">No paintings yet.</p>
		<RouterLink v-for="painting in paintings" :key="painting.id" :to="`/p/${painting.id}`">
			<figure>
			<img :src="imageUrl(painting, 'thumb')" :alt="painting.title" loading="lazy" />
			<figcaption>
				{{ painting.title || 'Untitled' }}
				<span class="muted">{{ painting.width_cm }} × {{ painting.height_cm }} cm</span>
				<span>{{ painting.status === 'available' ? formatPrice(painting.price) : painting.status }}</span>
			</figcaption>
			</figure>
		</RouterLink>
	</main>
</template>

<style>
#gallery {
	display: grid;
	grid-template-columns: repeat(auto-fill, minmax(12rem, 1fr));
	gap: var(--gap);

	& a {
		text-decoration: none;
	}

	& figure {
		margin: 0;

		& img {
			width: 100%;
			aspect-ratio: 1;
			object-fit: contain;
		}

		& figcaption {
			display: flex;
			flex-direction: column;
		}
	}
}
</style>
