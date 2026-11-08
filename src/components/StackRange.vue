<script setup lang="ts">
// a range of a stack in a merge or split preview: its first and last painting
import { computed } from 'vue'
import { imageUrl } from '@/api'
import type { AdminPainting } from '../../shared/types'

const props = defineProps<{ name: string; paintings: AdminPainting[] }>()
const first = computed(() => props.paintings[0])
const last = computed(() => (props.paintings.length > 1 ? props.paintings.at(-1) : undefined))
</script>

<template>
	<figure class="stack-range">
		<figcaption>
			<strong>{{ name }}</strong> <span class="muted">{{ paintings.length }} paintings<template v-if="first"> · #{{ first.number }}<template v-if="last"> – #{{ last.number }}</template></template></span>
		</figcaption>
		<div>
			<img v-if="first" :src="imageUrl(first, 'thumb')" :alt="`#${first.number}`" :title="`#${first.number}`" />
			<span v-if="paintings.length > 2" aria-hidden="true">…</span>
			<img v-if="last" :src="imageUrl(last, 'thumb')" :alt="`#${last.number}`" :title="`#${last.number}`" />
		</div>
	</figure>
</template>

<style>
.stack-range {
	display: flex;
	flex-direction: column;
	gap: var(--gap);
	margin: 0;
	padding: var(--gap);
	border: 1px solid color-mix(in srgb, var(--muted) 50%, transparent);
	border-radius: 0.3rem;

	& div {
		display: flex;
		align-items: center;
		gap: var(--gap);
	}

	& img {
		width: 9rem;
		height: 9rem;
		object-fit: contain;
	}
}
</style>
