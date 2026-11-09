<script setup lang="ts">
import { RouterLink } from 'vue-router'
import { formatPrice, imageUrl, loadPaintings, paintings, type PublicPainting } from '@/api'
import { ambient, cornerRadius, measureAmbient } from '@/ambient'

loadPaintings()

// each tile is a piece of wall in its painting's average color, with text in contrast to it
function tileStyle(painting: PublicPainting) {
	const a = ambient.get(painting.id)
	return a && { background: a.color, color: a.light ? '#222' : '#eee' }
}
</script>

<template>
	<main id="gallery">
		<p class="name">Thomas Fritsch – Digitale Gallerie an der Rax</p>
		<p v-if="paintings?.length === 0" class="muted">No paintings yet.</p>
		<div class="tiles">
			<RouterLink v-for="painting in paintings" :key="painting.id" :to="`/p/${painting.id}`" :style="tileStyle(painting)">
				<div class="wall">
					<img
						:src="imageUrl(painting, 'thumb')"
						:alt="painting.title"
						:style="{ borderRadius: cornerRadius(painting) }"
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
	/* name line; the login info floats at its right end */
	& .name {
		margin: 0 0 var(--gap);
		padding-right: 8rem;
	}

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
			background: color-mix(in srgb, var(--muted) 20%, transparent);
			transition: background 0.4s;

			& .wall {
				flex: 1;
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
