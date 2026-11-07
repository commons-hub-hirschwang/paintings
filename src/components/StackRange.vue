<script setup lang="ts">
// a range of a stack in a merge or split preview: its first and last painting
import { computed } from 'vue'
import { imageUrl } from '@/api'
import type { AdminPainting } from '../../shared/types'

const props = defineProps<{ name: string; paintings: AdminPainting[] }>()
const ends = computed(() => {
	const first = props.paintings[0]
	const last = props.paintings.at(-1)
	return first && last && first !== last ? [first, last] : first ? [first] : []
})
</script>

<template>
	<figure class="stack-range">
		<figcaption>
			<strong>{{ name }}</strong>
			<span class="muted"> {{ paintings.length }} paintings<template v-if="ends.length"> · {{ ends.map((p) => `#${p.number}`).join(' – ') }}</template></span>
		</figcaption>
		<div>
			<img v-for="painting in ends" :key="painting.id" :src="imageUrl(painting, 'thumb')" :alt="`#${painting.number}`" :title="`#${painting.number}`" />
		</div>
	</figure>
</template>

<style>
.stack-range {
	margin: 0;

	& div {
		display: flex;
		gap: var(--gap);
	}

	& img {
		width: 300px;
		max-width: 40vw;
		height: 300px;
		max-height: 40vw;
		object-fit: contain;
	}
}
</style>
