<script setup lang="ts">
import { ref } from 'vue'
import { fetchPaintings, imageUrl, type Painting } from '@/api'

const paintings = ref<Painting[]>([])
fetchPaintings().then((list) => (paintings.value = list))
</script>

<template>
	<main id="gallery">
		<p v-if="!paintings.length" class="muted">No paintings yet.</p>
		<figure v-for="painting in paintings" :key="painting.id">
			<img :src="imageUrl(painting, 'thumb')" :alt="painting.title" loading="lazy" />
			<figcaption>
				{{ painting.title || 'Untitled' }}
				<span class="muted">{{ painting.width_cm }} × {{ painting.height_cm }} cm</span>
			</figcaption>
		</figure>
	</main>
</template>

<style>
#gallery {
	display: grid;
	grid-template-columns: repeat(auto-fill, minmax(12rem, 1fr));
	gap: var(--gap);

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
