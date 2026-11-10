<script setup lang="ts">
// Aesthetic rating 1–10 per person. Size is NOT part of this: it is multiplied in separately by the pricing.
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import LoginGate from '@/components/LoginGate.vue'
import { authed, user } from '@/auth'
import { imageUrl } from '@/api'
import { cornerRadius, measureAmbient, usePageColors, wallColors } from '@/ambient'
import { canName, sizeLabel, stackLabel, type RatePainting } from '../../shared/types'

const paintings = ref<RatePainting[]>([])
const currentId = ref<string | null>(null)
const error = ref('')

const unrated = computed(() => paintings.value.filter((p) => p.my_score === null))
const rated = computed(() => paintings.value.filter((p) => p.my_score !== null))
const current = computed(() => paintings.value.find((p) => p.id === currentId.value) ?? null)
const scores = [10, 9, 8, 7, 6, 5, 4, 3, 2, 1]

async function load() {
	paintings.value = await authed<RatePainting[]>('/api/rate/paintings')
}
watch(user, (u) => u && load().catch((e) => (error.value = e.message)), { immediate: true })

// next unrated painting after the current one (wrapping); once all are rated, null: the overlay closes
function next() {
	const list = paintings.value
	const start = list.findIndex((p) => p.id === currentId.value)
	const ordered = [...list.slice(start + 1), ...list.slice(0, start + 1)]
	return ordered.find((p) => p.my_score === null)?.id ?? null
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

// authors and admins name paintings; saved when the field loses focus or on Enter
async function rename(painting: RatePainting, title: string) {
	if (title.trim() === painting.title) return
	error.value = ''
	try {
		await authed(`/api/rate/paintings/${painting.id}/title`, { method: 'PUT', body: JSON.stringify({ title }) })
		painting.title = title.trim()
	} catch (e) {
		error.value = (e as Error).message
	}
}

// overlay is open while a painting is selected; the page then takes that painting's wall color
const select = (id: string | null) => (currentId.value = id)
usePageColors(() => current.value && wallColors(current.value.id, current.value.color))

// keys 1–9, 0 = 10, Esc closes
function onKey(event: KeyboardEvent) {
	if (!current.value || event.target instanceof HTMLInputElement) return
	if (event.key === 'Escape') select(null)
	else if (/^[0-9]$/.test(event.key)) rate(event.key === '0' ? 10 : Number(event.key))
}
onMounted(() => window.addEventListener('keydown', onKey))
onBeforeUnmount(() => window.removeEventListener('keydown', onKey))
</script>

<template>
	<main id="rate">
		<LoginGate :roles="['admin', 'author', 'rater']">
			<header>
				<h1>Rate paintings</h1>
				<span class="muted">{{ rated.length }} of {{ paintings.length }} rated</span>
				<button v-if="unrated.length" @click="select(unrated[0]!.id)">Rate {{ unrated.length }} unrated</button>
			</header>
			<p v-if="error && !current" class="error">{{ error }}</p>
			<p v-if="!paintings.length" class="muted">No paintings to rate yet.</p>

			<section v-if="current" class="stage">
				<button class="close" title="Close (Esc)" @click="select(null)">×</button>
				<a class="wall" :href="imageUrl(current, 'detail')" target="_blank">
					<img
						:key="current.id"
						:src="imageUrl(current, 'detail')"
						:alt="current.title"
						:style="{ borderRadius: cornerRadius(current.width_cm, current.height_cm) }"
						@load="measureAmbient(current.id, $event.target as HTMLImageElement)"
					/>
				</a>
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
					<label v-if="canName(user?.role)">
						Name <span class="muted">{{ stackLabel(current) }}</span>
						<input
							:key="current.id"
							:value="current.title"
							placeholder="Untitled"
							@change="rename(current, ($event.target as HTMLInputElement).value)"
							@keydown.enter="($event.target as HTMLInputElement).blur()"
						/>
					</label>
					<p v-else>
						<strong>{{ current.title || 'Untitled' }}</strong> <span class="muted">{{ stackLabel(current) }}</span>
					</p>
					<p class="muted">{{ sizeLabel(current) }}</p>
					<p class="muted">
						{{ rated.length }} of {{ paintings.length }} rated<br />
						Keys 1–9, 0 = 10, Esc closes. Image opens in full detail.
					</p>
					<p v-if="error" class="error">{{ error }}</p>
				</aside>
			</section>

			<section v-for="section in [{ title: 'Not rated yet', list: unrated }, { title: 'Rated', list: rated }]" :key="section.title">
				<h2 v-if="section.list.length">{{ section.title }} ({{ section.list.length }})</h2>
				<div class="tiles">
					<a
						v-for="painting in section.list"
						:key="painting.id"
						href="#"
						:class="{ active: painting.id === currentId }"
						:style="wallColors(painting.id, painting.color)"
						@click.prevent="select(painting.id)"
					>
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
							<span>{{ stackLabel(painting) }} {{ painting.title || 'Untitled' }}</span>
							<span>{{ painting.my_score === null ? 'not rated' : `rated ${painting.my_score}` }}</span>
						</p>
					</a>
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

	& header {
		display: flex;
		flex-wrap: wrap;
		align-items: baseline;
		gap: var(--gap);
	}

	/* fullscreen overlay: image as large as fits (any aspect ratio) in the left 2/3, buttons starting at 2/3 width */
	& .stage {
		display: grid;
		grid-template-columns: 2fr 1fr;
		gap: var(--gap);
		position: fixed;
		inset: 0;
		z-index: 10;
		padding: var(--gap);
		background: var(--bg);
		color: var(--fg);
		transition: background 1s;

		& .close {
			position: absolute;
			top: var(--gap);
			right: var(--gap);
			font-size: 1.5rem;
			line-height: 1;
			border: none;
		}

		& aside {
			display: flex;
			flex-direction: column;
			gap: var(--gap);
			justify-content: center;
			min-height: 0;
			max-width: 12rem;
			font-size: 0.9rem;

			& p {
				margin: 0;
			}
		}

		& .wall {
			padding: min(3rem, 6vw);
		}

		@media (max-width: 40rem) {
			grid-template-columns: 1fr;
			grid-template-rows: 1fr auto;
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

	& .tiles {
		--tile: 11rem;

		& .active {
			outline: 2px solid var(--fg);
			outline-offset: -2px;
		}
	}
}
</style>
