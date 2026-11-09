<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { formatPrice, imageUrl, loadPaintings, paintings } from '@/api'
import { ambient, measureAmbient } from '@/ambient'
import { sizeLabel } from '../../shared/types'

const route = useRoute()
const router = useRouter()
const bought = computed(() => route.query.bought === '1')
const error = ref('')
const buying = ref(false)

if (!paintings.value) loadPaintings()

const index = computed(() => paintings.value?.findIndex((p) => p.id === route.params.id) ?? -1)
// undefined: still loading, null: not (publicly) there
const painting = computed(() => (paintings.value ? (paintings.value[index.value] ?? null) : undefined))
const previous = computed(() => (index.value > 0 ? paintings.value![index.value - 1] : undefined))
const next = computed(() => (index.value >= 0 ? paintings.value![index.value + 1] : undefined))

// replace: browser back always returns to the gallery, however many paintings were flipped through
const go = (to: { id: string } | undefined) => to && router.replace(`/p/${to.id}`)

function backToGallery() {
	if (history.state?.back === '/') router.back()
	else router.push('/')
}

async function buy() {
	buying.value = true
	error.value = ''
	const response = await fetch(`/api/checkout/${painting.value!.id}`, { method: 'POST' })
	const body = await response.json()
	if (response.ok) location.href = body.url
	else {
		error.value = body.error
		buying.value = false
	}
}

// ---------- magnifier: a lens following the pointer over the painting, showing the detail image ----------

const lensSize = 260
const magnifying = ref(false)
const lens = ref<{ x: number; y: number; width: number; height: number; px: number; py: number }>()
// native size: one detail-image pixel per screen pixel (2× until the detail image is loaded)
const detailWidth = ref(0)

function moveLens(event: MouseEvent) {
	if (!magnifying.value) return
	const rect = (event.currentTarget as HTMLElement).getBoundingClientRect()
	lens.value = {
		x: event.clientX,
		y: event.clientY,
		width: rect.width,
		height: rect.height,
		px: event.clientX - rect.left,
		py: event.clientY - rect.top,
	}
}

function toggleMagnifier(event: MouseEvent) {
	magnifying.value = !magnifying.value
	if (magnifying.value) moveLens(event)
	else lens.value = undefined
}

const lensStyle = computed(() => {
	const l = lens.value
	if (!l || !painting.value) return undefined
	const zoom = detailWidth.value ? Math.max(1, detailWidth.value / l.width) : 2
	return {
		width: `${lensSize}px`,
		height: `${lensSize}px`,
		left: `${l.x - lensSize / 2}px`,
		top: `${l.y - lensSize / 2}px`,
		backgroundImage: `url(${imageUrl(painting.value, 'detail')}), url(${imageUrl(painting.value, 'normal')})`,
		backgroundSize: `${l.width * zoom}px ${l.height * zoom}px`,
		backgroundPosition: `${lensSize / 2 - l.px * zoom}px ${lensSize / 2 - l.py * zoom}px`,
	}
})

watch(magnifying, (on) => {
	if (!on || !painting.value) return
	const detail = new Image()
	detail.onload = () => (detailWidth.value = detail.naturalWidth)
	detail.src = imageUrl(painting.value, 'detail')
})

// another painting: magnifier off, and the neighbours preloaded so flipping is instant
watch(
	painting,
	(p, old) => {
		if (p?.id === old?.id) return
		magnifying.value = false
		lens.value = undefined
		detailWidth.value = 0
		error.value = ''
		for (const neighbour of [previous.value, next.value]) if (neighbour) new Image().src = imageUrl(neighbour, 'normal')
	},
	{ immediate: true },
)

function onKey(event: KeyboardEvent) {
	if (event.altKey || event.ctrlKey || event.metaKey || event.target instanceof HTMLInputElement) return
	if (event.key === 'ArrowLeft') go(previous.value)
	else if (event.key === 'ArrowRight') go(next.value)
	else if (event.key === 'Escape') magnifying.value = false
	else return
	event.preventDefault()
}
onMounted(() => window.addEventListener('keydown', onKey))
onBeforeUnmount(() => window.removeEventListener('keydown', onKey))
</script>

<template>
	<main id="painting">
		<nav class="actions">
			<a href="/" @click.prevent="backToGallery">← Gallery</a>
			<button :disabled="!previous" title="previous (←)" @click="go(previous)">‹</button>
			<button :disabled="!next" title="next (→)" @click="go(next)">›</button>
		</nav>
		<p v-if="painting === null" class="muted">Painting not found.</p>
		<template v-else-if="painting">
			<div class="ambient" :style="{ '--ambient': ambient.get(painting.id) }">
				<img
					:key="painting.id"
					:src="imageUrl(painting, 'normal')"
					:alt="painting.title"
					:class="{ magnifying }"
					@load="measureAmbient(painting.id, $event.target as HTMLImageElement)"
					@click="toggleMagnifier"
					@pointermove="moveLens"
					@pointerdown="moveLens"
					@pointerleave="lens = undefined"
				/>
			</div>
			<div v-if="magnifying && lensStyle" class="lens" :style="lensStyle"></div>
			<aside>
				<h1>{{ painting.title || 'Untitled' }}</h1>
				<p class="muted">{{ sizeLabel(painting) }}</p>
				<p v-if="bought">Thank you for your purchase! We will contact you about pick-up or shipping.</p>
				<template v-else-if="painting.status === 'available' && painting.price">
					<p><strong>{{ formatPrice(painting.price) }}</strong></p>
					<button :disabled="buying" @click="buy">Buy</button>
					<p class="muted">Pick-up in Austria (free) or shipping, chosen at checkout.</p>
				</template>
				<p v-else class="muted">{{ painting.status === 'available' ? formatPrice(null) : painting.status }}</p>
				<p v-if="error" class="error">{{ error }}</p>
			</aside>
		</template>
	</main>
</template>

<style>
#painting {
	display: flex;
	flex-direction: column;
	gap: var(--gap);

	& nav {
		align-items: center;
	}

	& .ambient {
		width: min(100%, 85dvh);
		aspect-ratio: 1;
		align-self: center;
		padding: min(3rem, 6vw);

		& img {
			cursor: zoom-in;

			&.magnifying {
				cursor: zoom-out;
				touch-action: none;
			}
		}
	}

	& .lens {
		position: fixed;
		pointer-events: none;
		border-radius: 50%;
		border: 2px solid #fff;
		box-shadow: 0 0.3rem 1.2rem #000;
		background-repeat: no-repeat;
		background-color: #000;
	}
}
</style>
