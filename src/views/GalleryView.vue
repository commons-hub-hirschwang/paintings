<script setup lang="ts">
import { RouterLink } from 'vue-router'
import { formatPrice, imageUrl, loadPaintings, paintings } from '@/api'
import { cornerRadius, measureAmbient, wallColors } from '@/ambient'

loadPaintings()
</script>

<template>
	<main id="gallery">
		<p v-if="paintings?.length === 0" class="muted">No paintings yet.</p>
		<div class="tiles">
			<RouterLink v-for="painting in paintings" :key="painting.id" :to="`/p/${painting.id}`" :style="wallColors(painting.id, painting.color)">
				<div class="wall">
					<img
						:src="imageUrl(painting, 'thumb')"
						:alt="painting.title"
						:style="{ borderRadius: cornerRadius(painting.width_cm, painting.height_cm) }"
						loading="lazy"
						@load="measureAmbient(painting.id, $event.target as HTMLImageElement)"
					/>
				</div>
				<p>
					<span>{{ painting.title || 'Untitled' }}</span>
					<span>{{ painting.status === 'available' ? formatPrice(painting.price) : painting.status }}</span>
				</p>
			</RouterLink>
		</div>
	</main>
</template>

<style>
#gallery {
	/* tiles side by side without gaps: the walls meet; painting and caption always fit into their square */
	& .tiles {
		display: grid;
		grid-template-columns: repeat(auto-fill, minmax(16rem, 1fr));

		& a {
			display: flex;
			flex-direction: column;
			gap: var(--gap);
			aspect-ratio: 1;
			padding: calc(1.5 * var(--gap));
			text-decoration: none;
			/* a piece of wall in its painting's color (set per tile), text in contrast to it */
			background: var(--bg);
			color: var(--fg);
			transition: background 0.4s;

			& .wall {
				flex: 1;

				/* small paintings: a tighter shadow than the single view's */
				& img {
					box-shadow: 0 0.15rem 0.5rem #000;
				}
			}

			& p {
				display: flex;
				flex-direction: column;
				margin: 0;

				& span:first-child {
					overflow: hidden;
					text-overflow: ellipsis;
					white-space: nowrap;
				}

				& span:last-child {
					opacity: 0.7;
				}
			}
		}
	}
}
</style>
