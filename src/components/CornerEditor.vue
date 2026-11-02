<script setup lang="ts">
// Set the 4 painting corners: press anywhere and the nearest corner moves with the mouse (cursor hidden,
// magnifier shown, Shift = 1/10 speed). Arrow keys nudge the selected corner by 1 px (Shift: 10 px), keys 1–4 select.
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import type { Point, Quad } from '../../shared/geometry'

const props = defineProps<{ src: string }>()
const quad = defineModel<Quad | null>({ required: true }) // null until the parent sets corners on `loaded`
const emit = defineEmits<{ loaded: [size: { width: number; height: number }] }>()

const LOUPE = 220 // css px
const ZOOM = 2 // loupe css px per photo px
const labels = ['top left', 'top right', 'bottom right', 'bottom left']

const image = ref<HTMLImageElement>()
const loupe = ref<HTMLCanvasElement>()
const natural = ref({ width: 0, height: 0 })
const displayScale = ref(1) // css px per photo px
const selected = ref(0)
const dragging = ref(false)
const loupeVisible = ref(false)

const points = computed(() => (quad.value ?? []).map((p) => `${p.x},${p.y}`).join(' '))
const handleRadius = computed(() => 14 / displayScale.value)

function onLoad() {
	const img = image.value!
	natural.value = { width: img.naturalWidth, height: img.naturalHeight }
	updateScale()
	emit('loaded', natural.value)
}

function updateScale() {
	if (image.value && natural.value.width) displayScale.value = image.value.clientWidth / natural.value.width
}

const resizeObserver = new ResizeObserver(updateScale)
onMounted(() => resizeObserver.observe(image.value!))
onBeforeUnmount(() => resizeObserver.disconnect())

function setCorner(index: number, point: Point) {
	const next = [...quad.value!] as Quad
	next[index] = point
	quad.value = next
}

// Press anywhere: the nearest corner follows the pointer *relatively* (no jump), with the cursor hidden
// (pointer lock) and the magnifier shown instead. Shift: 1/10 speed for precision.
let dragPoint: Point = { x: 0, y: 0 } // local, since v-model updates lag one render behind
let lastClient: Point = { x: 0, y: 0 }

function startDrag(event: PointerEvent) {
	if (!quad.value || event.button !== 0) return
	const rect = image.value!.getBoundingClientRect()
	const pointer = { x: (event.clientX - rect.left) / displayScale.value, y: (event.clientY - rect.top) / displayScale.value }
	const distances = quad.value.map((corner) => Math.hypot(corner.x - pointer.x, corner.y - pointer.y))
	selected.value = distances.indexOf(Math.min(...distances))
	dragPoint = { ...quad.value[selected.value]! }
	lastClient = { x: event.clientX, y: event.clientY }
	dragging.value = true
	loupeVisible.value = true
	const editor = event.currentTarget as HTMLElement
	editor.setPointerCapture(event.pointerId)
	if (event.pointerType === 'mouse') Promise.resolve(editor.requestPointerLock()).catch(() => {})
}

function drag(event: PointerEvent) {
	if (!dragging.value) return
	// locked mouse: clientX is frozen, use movementX; touch/pen: client deltas
	const locked = document.pointerLockElement !== null
	const dx = locked ? event.movementX : event.clientX - lastClient.x
	const dy = locked ? event.movementY : event.clientY - lastClient.y
	lastClient = { x: event.clientX, y: event.clientY }
	const speed = (event.shiftKey ? 0.1 : 1) / displayScale.value
	const clamp = (value: number, max: number) => Math.min(Math.max(value, 0), max)
	dragPoint = {
		x: clamp(dragPoint.x + dx * speed, natural.value.width),
		y: clamp(dragPoint.y + dy * speed, natural.value.height),
	}
	setCorner(selected.value, dragPoint)
}

function endDrag() {
	if (!dragging.value) return
	dragging.value = false
	loupeVisible.value = false
	if (document.pointerLockElement) document.exitPointerLock()
}

function onKey(event: KeyboardEvent) {
	if (event.target instanceof HTMLInputElement || !quad.value) return
	if (['1', '2', '3', '4'].includes(event.key)) {
		selected.value = Number(event.key) - 1
		loupeVisible.value = true
		return
	}
	const step = event.shiftKey ? 10 : 1
	const delta = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] }[event.key]
	if (event.key === 'Escape') loupeVisible.value = false
	if (!delta) return
	event.preventDefault()
	const corner = quad.value[selected.value]!
	loupeVisible.value = true
	setCorner(selected.value, { x: corner.x + delta[0]!, y: corner.y + delta[1]! })
}
onMounted(() => window.addEventListener('keydown', onKey))
onBeforeUnmount(() => window.removeEventListener('keydown', onKey))

// v-model updates arrive after the parent re-renders, so draw from a post-flush watcher, not right after setting
watch([quad, selected, loupeVisible], () => loupeVisible.value && drawLoupe(), { flush: 'post' })

function drawLoupe() {
	const canvas = loupe.value
	const img = image.value
	if (!canvas || !img || !quad.value) return
	const dpr = window.devicePixelRatio
	canvas.width = canvas.height = LOUPE * dpr
	const ctx = canvas.getContext('2d')!
	const corner = quad.value[selected.value]!
	const span = LOUPE / ZOOM // photo px visible in the loupe
	ctx.imageSmoothingEnabled = false
	ctx.fillStyle = '#000'
	ctx.fillRect(0, 0, canvas.width, canvas.height)
	ctx.drawImage(img, corner.x - span / 2, corner.y - span / 2, span, span, 0, 0, canvas.width, canvas.height)
	// quad edges through this corner
	ctx.strokeStyle = 'rgba(255, 220, 0, 0.8)'
	ctx.lineWidth = dpr
	ctx.beginPath()
	for (const neighbor of [quad.value[(selected.value + 3) % 4]!, quad.value[(selected.value + 1) % 4]!]) {
		ctx.moveTo(canvas.width / 2, canvas.height / 2)
		ctx.lineTo(canvas.width / 2 + (neighbor.x - corner.x) * ZOOM * dpr, canvas.height / 2 + (neighbor.y - corner.y) * ZOOM * dpr)
	}
	ctx.stroke()
	// crosshair
	ctx.strokeStyle = '#f0f'
	ctx.beginPath()
	ctx.moveTo(canvas.width / 2, 0)
	ctx.lineTo(canvas.width / 2, canvas.height)
	ctx.moveTo(0, canvas.height / 2)
	ctx.lineTo(canvas.width, canvas.height / 2)
	ctx.stroke()
}

// loupe sits diagonally away from the corner, towards the photo's center, so it never covers the corner
const loupeStyle = computed(() => {
	if (!quad.value) return {}
	const corner = quad.value[selected.value]!
	const s = displayScale.value
	const left = corner.x < natural.value.width / 2 ? corner.x * s + 30 : corner.x * s - LOUPE - 30
	const top = corner.y < natural.value.height / 2 ? corner.y * s + 30 : corner.y * s - LOUPE - 30
	return { left: `${left}px`, top: `${top}px`, width: `${LOUPE}px`, height: `${LOUPE}px` }
})
</script>

<template>
	<div id="corner-editor" :class="{ dragging }" @pointerdown.prevent="startDrag" @pointermove="drag" @pointerup="endDrag" @pointercancel="endDrag">
		<img ref="image" :src="props.src" alt="captured photo" draggable="false" @load="onLoad" />
		<svg v-if="natural.width && quad" :viewBox="`0 0 ${natural.width} ${natural.height}`" preserveAspectRatio="none">
			<polygon :points="points" />
			<circle
				v-for="(corner, index) in quad"
				:key="index"
				:cx="corner.x"
				:cy="corner.y"
				:r="handleRadius"
				:class="{ selected: index === selected }"
			>
				<title>{{ index + 1 }}: {{ labels[index] }}</title>
			</circle>
		</svg>
		<canvas v-show="loupeVisible" ref="loupe" :style="loupeStyle" />
	</div>
</template>

<style>
#corner-editor {
	position: relative;
	display: inline-block;
	touch-action: none;
	user-select: none;
	cursor: crosshair;

	&.dragging {
		cursor: none;
	}

	& img {
		display: block;
		max-width: 100%;
		max-height: 75vh;
	}

	& svg {
		position: absolute;
		inset: 0;
		width: 100%;
		height: 100%;
		overflow: visible;

		& polygon {
			fill: rgba(255, 220, 0, 0.08);
			stroke: rgb(255, 220, 0);
			stroke-width: 1.5px;
			vector-effect: non-scaling-stroke;
		}

		& circle {
			fill: rgba(255, 220, 0, 0.4);
			stroke: #000;
			stroke-width: 1px;
			vector-effect: non-scaling-stroke;

			&.selected {
				fill: rgba(255, 0, 255, 0.5);
			}
		}
	}

	& canvas {
		position: absolute;
		border-radius: 50%;
		border: 2px solid #fff;
		box-shadow: 0 0 0 1px #000, 0 4px 16px rgba(0, 0, 0, 0.5);
		pointer-events: none;
	}
}
</style>
