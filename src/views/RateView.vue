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
const scores = [10, 9, 8, 7, 6, 5, 4, 3, 2, 1]

async function load() {
	paintings.value = await authed<RatePainting[]>('/api/rate/paintings')
	currentId.value ??= (unrated.value[0] ?? paintings.value[0])?.id ?? null
}
watch(user, (u) => u && load().catch((e) => (error.value = e.message)), { immediate: true })

// next unrated painting after the current one (wrapping); once all are rated, simply the next painting
function next() {
	const list = paintings.value
	const start = list.findIndex((p) => p.id === currentId.value)
	const ordered = [...list.slice(start + 1), ...list.slice(0, start + 1)]
	return (ordered.find((p) => p.my_score === null) ?? ordered[0])?.id ?? null
}

async function rate(score: number) {
	const painting = current.value
	if (!painting) return
	error.value = ''
	try {
		await authed(`/api/rate/paintings/${painting.id}`, { method: 'PUT', body: JSON.stringify({ score }) })
		painting.my_score = score
		currentId.value = next()
	} catch (e) {
		error.value = (e as Error).message
	}
}

function select(id: string) {
	currentId.value = id
	window.scrollTo({ top: 0 })
}

// keys 1–9, 0 = 10
function onKey(event: KeyboardEvent) {
	if (!current.value || event.target instanceof HTMLInputElement) return
	if (/^[0-9]$/.test(event.key)) rate(event.key === '0' ? 10 : Number(event.key))
}
onMounted(() => window.addEventListener('keydown', onKey))
onBeforeUnmount(() => window.removeEventListener('keydown', onKey))
</script>

<template>
	<main id="rate">
		<LoginGate :roles="['admin', 'rater']">
			<section v-if="current" class="stage">
				<aside>
					<p>
						Rate the <strong>aesthetics only</strong>: 1 weak – 10 outstanding.
						<span class="muted">Size is applied separately in the price.</span>
					</p>
					<div class="scores">
						<button v-for="score in scores" :key="score" :class="{ chosen: current.my_score === score }" @click="rate(score)">
							{{ score }}
						</button>
					</div>
					<p>
						<strong>{{ current.title || 'Untitled' }}</strong>
						<br />
						<span class="muted">{{ current.width_cm }} × {{ current.height_cm }} cm</span>
					</p>
					<p class="muted">
						{{ rated.length }} of {{ paintings.length }} rated<br />
						Keys 1–9, 0 = 10. Image opens in full detail.
					</p>
					<p v-if="error" class="error">{{ error }}</p>
				</aside>
				<a :href="imageUrl(current, 'detail')" target="_blank">
					<img :src="imageUrl(current, 'detail')" :alt="current.title" />
				</a>
			</section>
			<p v-else-if="error" class="error">{{ error }}</p>
			<p v-else class="muted">No paintings to rate yet.</p>

			<section v-for="group in [{ title: 'Not rated yet', list: unrated }, { title: 'Rated', list: rated }]" :key="group.title">
				<h2 v-if="group.list.length">{{ group.title }} ({{ group.list.length }})</h2>
				<div class="grid">
					<figure
						v-for="painting in group.list"
						:key="painting.id"
						:class="{ active: painting.id === currentId }"
						@click="select(painting.id)"
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

	/* fills the viewport: fixed sidebar with the buttons, image as large as fits (any aspect ratio) */
	& .stage {
		display: grid;
		grid-template-columns: 11rem 1fr;
		gap: var(--gap);
		height: calc(100dvh - 2 * var(--gap));

		& aside {
			display: flex;
			flex-direction: column;
			gap: var(--gap);
			min-height: 0;
			font-size: 0.9rem;

			& p {
				margin: 0;
			}
		}

		& > a {
			min-width: 0;
			min-height: 0;
		}

		& > a img {
			display: block;
			width: 100%;
			height: 100%;
			object-fit: contain;
			object-position: center top;
		}

		@media (max-width: 40rem) {
			grid-template-columns: 1fr;
			grid-template-rows: auto 60dvh;
			height: auto;
		}
	}

	& .scores {
		display: flex;
		flex-direction: column;
		gap: 0.3rem;

		@media (max-width: 40rem) {
			flex-direction: row-reverse;
		}

		& button {
			flex: 1;
			padding: 0.35rem 0;

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
