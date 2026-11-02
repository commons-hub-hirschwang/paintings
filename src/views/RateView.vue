<script setup lang="ts">
// Aesthetic rating 1–10 per person. Size is NOT part of this: it is multiplied in separately by the pricing.
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import LoginGate from '@/components/LoginGate.vue'
import { authed, user } from '@/auth'
import { imageUrl } from '@/api'
import type { RatePainting } from '../../shared/types'

const paintings = ref<RatePainting[]>([])
const currentId = ref<string | null>(null)
const error = ref('')

const unrated = computed(() => paintings.value.filter((p) => p.my_score === null))
const rated = computed(() => paintings.value.filter((p) => p.my_score !== null))
const current = computed(() => paintings.value.find((p) => p.id === currentId.value) ?? null)

async function load() {
	paintings.value = await authed<RatePainting[]>('/api/rate/paintings')
	currentId.value ??= unrated.value[0]?.id ?? null
}
watch(user, (u) => u && load().catch((e) => (error.value = e.message)), { immediate: true })

async function rate(score: number) {
	const painting = current.value
	if (!painting) return
	error.value = ''
	try {
		await authed(`/api/rate/paintings/${painting.id}`, { method: 'PUT', body: JSON.stringify({ score }) })
		painting.my_score = score
		currentId.value = unrated.value[0]?.id ?? null
	} catch (e) {
		error.value = (e as Error).message
	}
}

// keys 1–9, 0 = 10
function onKey(event: KeyboardEvent) {
	if (!current.value || event.target instanceof HTMLInputElement) return
	if (/^[0-9]$/.test(event.key)) rate(event.key === '0' ? 10 : Number(event.key))
}
onMounted(() => window.addEventListener('keydown', onKey))
onBeforeUnmount(() => window.removeEventListener('keydown', onKey))

const size = (p: RatePainting) => `${p.width_cm} × ${p.height_cm} cm`
</script>

<template>
	<main id="rate">
		<h1>Rate paintings</h1>
		<LoginGate :roles="['admin', 'rater']">
			<p class="warning">
				Rate the <strong>aesthetics only</strong>, 1 (weak) to 10 (outstanding). Size does not matter here — it is applied as
				a separate factor in the price.
			</p>
			<p v-if="error" class="error">{{ error }}</p>

			<section v-if="current" class="current">
				<a :href="imageUrl(current, 'detail')" target="_blank">
					<img :src="imageUrl(current, 'normal')" :alt="current.title" />
				</a>
				<div class="panel">
					<h2>{{ current.title || 'Untitled' }}</h2>
					<p class="muted">{{ size(current) }} · your rating: {{ current.my_score ?? '–' }}</p>
					<div class="scores">
						<button v-for="score in 10" :key="score" :class="{ chosen: current.my_score === score }" @click="rate(score)">
							{{ score }}
						</button>
					</div>
					<p class="muted">Keys 1–9, 0 = 10. Click the image for full detail.</p>
				</div>
			</section>
			<p v-else-if="paintings.length">All {{ paintings.length }} paintings rated — thank you! Click one to change your rating.</p>
			<p v-else class="muted">No paintings to rate yet.</p>

			<section v-for="group in [{ title: 'Not rated yet', list: unrated }, { title: 'Rated', list: rated }]" :key="group.title">
				<h2 v-if="group.list.length">{{ group.title }} ({{ group.list.length }})</h2>
				<div class="grid">
					<figure
						v-for="painting in group.list"
						:key="painting.id"
						:class="{ active: painting.id === currentId }"
						@click="currentId = painting.id"
					>
						<img :src="imageUrl(painting, 'thumb')" :alt="painting.title" loading="lazy" />
						<figcaption>
							{{ painting.title || 'Untitled' }}
							<span class="muted">{{ painting.my_score ?? '' }}</span>
						</figcaption>
					</figure>
				</div>
			</section>
		</LoginGate>
	</main>
</template>

<style>
#rate {
	display: flex;
	flex-direction: column;
	gap: var(--gap);

	& .current {
		display: flex;
		flex-wrap: wrap;
		gap: var(--gap);

		& img {
			max-width: 100%;
			max-height: 70vh;
		}

		& .panel {
			flex: 1 1 16rem;
		}
	}

	& .scores {
		display: grid;
		grid-template-columns: repeat(5, 3rem);
		gap: 0.5rem;

		& button {
			aspect-ratio: 1;

			&.chosen {
				background: var(--fg);
				color: var(--bg);
			}
		}
	}

	& .grid {
		display: grid;
		grid-template-columns: repeat(auto-fill, minmax(8rem, 1fr));
		gap: var(--gap);

		& figure {
			margin: 0;
			cursor: pointer;

			&.active {
				outline: 2px solid var(--fg);
			}
		}

		& img {
			width: 100%;
			aspect-ratio: 1;
			object-fit: contain;
		}

		& figcaption {
			display: flex;
			justify-content: space-between;
		}
	}
}
</style>
