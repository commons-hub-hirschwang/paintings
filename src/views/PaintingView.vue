<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch, watchEffect } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { formatPrice, imageUrl, loadPaintings, paintings } from '@/api'
import { cornerRadius, measureAmbient, wallColors } from '@/ambient'
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
// the next painting slides in from the right, the previous one from the left: like walking along the wall
const slide = ref<'from-right' | 'from-left'>()
function go(to: { id: string } | undefined, direction: 1 | -1) {
	if (!to) return
	slide.value = direction > 0 ? 'from-right' : 'from-left'
	router.replace(`/p/${to.id}`)
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
	if (swiped) return (swiped = false)
	magnifying.value = !magnifying.value
	if (magnifying.value) moveLens(event)
	else lens.value = undefined
}

// both lens and its content are placed with transforms: those stay sub-pixel, so the content glides instead of
// snapping to whole pixels independently of the lens (which made it wiggle)
const lensStyle = computed(() => {
	const l = lens.value
	if (!l) return undefined
	return {
		width: `${lensSize}px`,
		height: `${lensSize}px`,
		transform: `translate(${l.x - lensSize / 2}px, ${l.y - lensSize / 2}px)`,
	}
})
const lensContentStyle = computed(() => {
	const l = lens.value
	if (!l) return undefined
	const zoom = detailWidth.value ? Math.max(1, detailWidth.value / l.width) : 2
	return {
		width: `${l.width * zoom}px`,
		height: `${l.height * zoom}px`,
		transform: `translate(${lensSize / 2 - l.px * zoom}px, ${lensSize / 2 - l.py * zoom}px)`,
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

// the whole page takes the painting's average color, text in contrast to it
const pageColors = ['--bg', '--fg', '--muted']
function resetPageColors() {
	for (const name of pageColors) document.documentElement.style.removeProperty(name)
}
watchEffect(() => {
	const colors = painting.value && wallColors(painting.value.id, painting.value.color)
	if (!colors) return resetPageColors()
	for (const [name, value] of Object.entries(colors)) document.documentElement.style.setProperty(name, value)
})
onBeforeUnmount(resetPageColors)

// The painting is sized here, not by CSS: as large as it fits next to the info and ‹ ›. Those are beside it on a wide
// screen and below it on a tall one, whatever the painting's shape: they stay where they were while flipping. Painting,
// buttons and info: centered together on a wide screen; on a tall one (phones) the painting in the middle, ‹ › and info at
// the bottom.
const content = ref<HTMLElement>()
const wall = ref<HTMLElement>()
const aside = ref<HTMLElement>()
const contentSize = ref({ width: 0, height: 0 })
const asideHeight = ref(0)
const natural = ref({ width: 0, height: 0 })
const observer = new ResizeObserver((entries) => {
	for (const { target, contentRect } of entries) {
		if (target === content.value) contentSize.value = { width: contentRect.width, height: contentRect.height }
		else asideHeight.value = contentRect.height
	}
})
for (const element of [content, aside])
	watch(element, (now, old) => {
		if (old) observer.unobserve(old)
		if (now) observer.observe(now)
	})
onBeforeUnmount(() => observer.disconnect())
// the next painting's own size, once its image is there
watch(() => painting.value?.id, () => (natural.value = { width: 0, height: 0 }))
const layout = computed(() => {
	const p = painting.value
	const button = content.value?.querySelector('button')
	if (!p || !button || !wall.value || !contentSize.value.height) return { mode: 'below', img: undefined }
	const ratio = p.width_cm && p.height_cm ? p.width_cm / p.height_cm : natural.value.width / natural.value.height || 1
	const gap = parseFloat(getComputedStyle(content.value!).rowGap) || 0
	const padding = 2 * parseFloat(getComputedStyle(wall.value).paddingLeft)
	const width = contentSize.value.width
	const height = contentSize.value.height - asideHeight.value - gap
	// painting width when it fits into a box; never beyond the image's own size
	const fit = (w: number, h: number) => Math.max(0, Math.min(w - padding, (h - padding) * ratio, natural.value.width || Infinity))
	const mode = width > contentSize.value.height ? 'beside' : 'below'
	// whole pixels: rounding must not push a button onto the next line
	const imgWidth = Math.floor(
		mode === 'beside' ? fit(width - 2 * (button.offsetWidth + gap), height) : fit(width, height - button.offsetHeight - gap),
	)
	return { mode, img: { width: `${imgWidth}px`, height: `${imgWidth / ratio}px` } }
})

// swipe (touch): the painting follows the finger; far enough flips to the neighbour, else it springs back. Towards an end
// of the list it only moves reluctantly.
const swipe = ref<{ pointer: number; x: number; dx: number }>()
// a swipe ends in a click on the painting: not a magnifier toggle
let swiped = false
function swipeStart(event: PointerEvent) {
	if (event.pointerType !== 'touch' || magnifying.value || swipe.value) return
	swiped = false
	swipe.value = { pointer: event.pointerId, x: event.clientX, dx: 0 }
}
function swipeMove(event: PointerEvent) {
	const s = swipe.value
	if (event.pointerId !== s?.pointer) return
	const dx = event.clientX - s.x
	s.dx = (dx > 0 ? previous.value : next.value) ? dx : dx / 3
	if (Math.abs(dx) > 10) swiped = true
}
// pointercancel: the browser took over (a vertical scroll), back to the middle
function swipeEnd(event: PointerEvent) {
	const s = swipe.value
	if (event.pointerId !== s?.pointer) return
	swipe.value = undefined
	if (event.type === 'pointerup' && Math.abs(s.dx) > Math.min(80, innerWidth / 5)) s.dx > 0 ? go(previous.value, -1) : go(next.value, 1)
}
const swipeStyle = computed(() =>
	swipe.value ? { transform: `translateX(${swipe.value.dx}px)`, transition: 'none' } : { transform: 'none', transition: 'transform 0.2s' },
)

function onLoad(event: Event) {
	const img = event.target as HTMLImageElement
	measureAmbient(painting.value!.id, img)
	natural.value = { width: img.naturalWidth, height: img.naturalHeight }
}

function onKey(event: KeyboardEvent) {
	if (event.altKey || event.ctrlKey || event.metaKey || event.target instanceof HTMLInputElement) return
	if (event.key === 'ArrowLeft') go(previous.value, -1)
	else if (event.key === 'ArrowRight') go(next.value, 1)
	else if (event.key === 'Escape') magnifying.value = false
	else return
	event.preventDefault()
}
onMounted(() => window.addEventListener('keydown', onKey))
onBeforeUnmount(() => window.removeEventListener('keydown', onKey))
</script>

<template>
	<!-- swipes anywhere on the page, not only on the painting -->
	<main id="painting" @pointerdown="swipeStart" @pointermove="swipeMove" @pointerup="swipeEnd" @pointercancel="swipeEnd">
		<p v-if="painting === null" class="muted">Painting not found.</p>
		<template v-else-if="painting">
			<div ref="content" class="content" :class="layout.mode">
			<div class="stage" :class="layout.mode">
				<button class="previous" :disabled="!previous" title="previous (←)" @click="go(previous, -1)">‹</button>
				<div ref="wall" class="wall">
				<img
					:key="painting.id"
					:src="imageUrl(painting, 'normal')"
					:alt="painting.title"
					:class="[{ magnifying }, slide]"
					:style="{ borderRadius: cornerRadius(painting.width_cm, painting.height_cm), ...layout.img, ...swipeStyle }"
					@load="onLoad"
					@click="toggleMagnifier"
					@pointermove="moveLens"
					@pointerdown="moveLens"
					@pointerleave="lens = undefined"
				/>
				</div>
				<button class="next" :disabled="!next" title="next (→)" @click="go(next, 1)">›</button>
			</div>
			<div v-if="magnifying && lensStyle" class="lens" :style="lensStyle">
				<!-- normal image until the detail one (on top) has loaded -->
				<img :src="imageUrl(painting, 'normal')" alt="" :style="lensContentStyle" />
				<img :src="imageUrl(painting, 'detail')" alt="" :style="lensContentStyle" />
			</div>
			<aside ref="aside">
				<div>
					<h1>{{ painting.title || 'Untitled' }}</h1>
					<p class="muted">{{ sizeLabel(painting) }}</p>
				</div>
				<div>
					<p v-if="bought">Thank you for your purchase! We will contact you about pick-up or shipping.</p>
					<template v-else-if="painting.status === 'available' && painting.price">
						<p class="actions">
							<strong>{{ formatPrice(painting.price) }}</strong>
							<button :disabled="buying" @click="buy">Buy</button>
						</p>
						<p class="muted">Pick-up in Austria (free) or shipping, chosen at checkout.</p>
					</template>
					<p v-else class="muted">{{ painting.status === 'available' ? formatPrice(null) : painting.status }}</p>
					<p v-if="error" class="error">{{ error }}</p>
				</div>
			</aside>
			</div>
		</template>
	</main>
</template>

<style>
/* header, painting and info always fit the viewport; the painting takes what is left */
#app:has(#painting) {
	display: flex;
	flex-direction: column;
	height: 100dvh;
}

#painting {
	/* horizontal moves are swipes (handled here), vertical ones scroll */
	touch-action: pan-y pinch-zoom;
	display: flex;
	flex-direction: column;
	gap: var(--gap);
	flex: 1;
	min-height: 0;

	/* below the nav: painting, ‹ › and info, centered together; the painting's size is set by the script (layout) */
	& .content {
		flex: 1;
		min-height: 0;
		display: flex;
		flex-direction: column;
		justify-content: center;
		gap: var(--gap);
		position: relative;

		/* tall screen: painting from the top, info and buying at the bottom */
		&.below {
			justify-content: space-between;
		}
	}

	& .stage {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		justify-content: center;
		gap: var(--gap);

		/* at the sides, in the middle of the space below the nav: the same spot for every painting, so the mouse can rest
		   on them while flipping (layout keeps their room free) */
		&.beside > button {
			position: absolute;
			top: 50%;
			translate: 0 -50%;

			&.previous {
				left: 0;
			}

			&.next {
				right: 0;
			}
		}

		/* the painting centered in all the room there is, the buttons at its bottom (above the info): the same spot for
		   every painting */
		&.below {
			flex: 1;
			min-height: 0;
			display: grid;
			grid-template-columns: 1fr auto auto 1fr;
			grid-template-rows: minmax(0, 1fr) auto;

			& .wall {
				grid-area: 1 / 1 / 2 / -1;
				place-self: center;
			}

			& .previous {
				grid-area: 2 / 2;
			}

			& .next {
				grid-area: 2 / 3;
			}
		}

		& > button {
			font-size: 1.5rem;
			line-height: 1;
			padding: 0.4rem 0.9rem;
		}
	}

	& .wall {
		padding: min(3rem, 6vw);

		& img {
			cursor: zoom-in;
			/* a new painting (key) comes in from the side it was in */
			&.from-right {
				animation: slide-in 0.35s ease-out;
				--from: 100vw;
			}

			&.from-left {
				animation: slide-in 0.35s ease-out;
				--from: -100vw;
			}

			&.magnifying {
				cursor: zoom-out;
				touch-action: none;
			}
		}
	}

	& aside {
		display: flex;
		flex-wrap: wrap;
		justify-content: space-between;
		gap: var(--gap);

		& > div {
			display: flex;
			flex-direction: column;
			gap: 0.3rem;

			/* price and buying on the right */
			&:last-child {
				align-items: flex-end;
				margin-left: auto;
				text-align: right;
			}
		}

		& p {
			margin: 0;
			align-items: center;
		}
	}

	& .lens {
		position: fixed;
		top: 0;
		left: 0;
		overflow: hidden;
		pointer-events: none;
		border-radius: 50%;
		/* outline, not border: the content's origin stays the lens' corner */
		outline: 2px solid #fff;
		box-shadow: 0 0.3rem 1.2rem #000;
		/* beyond the painting's edge: the wall */
		background: var(--bg);
		will-change: transform;

		& img {
			position: absolute;
			top: 0;
			left: 0;
			max-width: none;
			will-change: transform;
		}
	}
}

@keyframes slide-in {
	from {
		translate: var(--from) 0;
	}
}
</style>
