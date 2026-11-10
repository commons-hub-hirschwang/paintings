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
