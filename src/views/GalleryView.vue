<script setup lang="ts">
import { RouterLink } from 'vue-router'
import { formatPrice, imageUrl, loadPaintings, paintings } from '@/api'
import { ambient, measureAmbient } from '@/ambient'
import { sizeLabel } from '../../shared/types'

loadPaintings()
</script>

<template>
	<main id="gallery">
		<p v-if="paintings?.length === 0" class="muted">No paintings yet.</p>
		<RouterLink v-for="painting in paintings" :key="painting.id" :to="`/p/${painting.id}`">
			<figure>
				<div class="ambient" :style="{ '--ambient': ambient.get(painting.id) }">
					<img
						:src="imageUrl(painting, 'thumb')"
						:alt="painting.title"
						loading="lazy"
						@load="measureAmbient(painting.id, $event.target as HTMLImageElement)"
					/>
				</div>
				<figcaption>
					{{ painting.title || 'Untitled' }}
					<span class="muted">{{ sizeLabel(painting) }}</span>
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

		& .ambient {
			aspect-ratio: 1;
			padding: 12%;
		}

		& figcaption {
			display: flex;
			flex-direction: column;
		}
	}
}
</style>
