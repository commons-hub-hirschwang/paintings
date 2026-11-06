<script setup lang="ts">
// Set the 4 painting corners: press anywhere and the nearest corner moves with the mouse (cursor hidden,
// magnifier shown, Shift = 1/10 speed). Arrow keys nudge the selected corner by 1 px (Shift: 10 px), keys 1–4 select.
// The view can be turned in quarter turns (painting photographed sideways): the parent turns the corner order
// along (turnCorners), the photo itself stays as it is; all screen input is turned back into photo coordinates.
// Each side shows its measured curve (bows, true to scale) and the range it may curve in.
import { computed, onBeforeUnmount, onMounted, ref, shallowRef, watch } from 'vue'
import OverexposureMarks from './OverexposureMarks.vue'
import type { Bow } from './bridge'
import { MAX_BOW, type Point, type Quad } from '../shared/geometry'

const props = defineProps<{ src: string; turns: number; bows: Bow[] | null }>() // turns: clockwise quarter turns of the view
const quad = defineModel<Quad | null>({ required: true }) // null until the parent sets corners on `loaded`
const emit = defineEmits<{ loaded: [size: { width: number; height: number }]; turn: [direction: 1 | -1] }>()
const photo = shallowRef<HTMLImageElement | null>(null)

const LOUPE = 220 // css px
const ZOOM = 2 // loupe css px per photo px
const labels = ['top left', 'top right', 'bottom right', 'bottom left']

const frame = ref<HTMLElement>()
const loupe = ref<HTMLCanvasElement>()
const natural = ref({ width: 0, height: 0 })
const displayScale = ref(1) // css px per photo px
const sideways = computed(() => props.turns % 2 === 1)
const selected = ref(0)
const dragging = ref(false)
const loupeVisible = ref(false)

const points = computed(() => (quad.value ?? []).map((p) => `${p.x},${p.y}`).join(' '))
const handleRadius = computed(() => 14 / displayScale.value)

// per side: quadratic curves through the corners (a control point twice as far out as the curve's middle)
const sides = computed(() =>
	(quad.value ?? []).map((a, k) => {
		const b = quad.value![(k + 1) % 4]!
		const length = Math.hypot(b.x - a.x, b.y - a.y) || 1
		const n = { x: -(b.y - a.y) / length, y: (b.x - a.x) / length } // inwards
		const middle = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }
		const at = (offset: number) => ({ x: middle.x + n.x * offset, y: middle.y + n.y * offset })
		const curve = (offset: number, from = a, to = b) => {
			const control = at(offset * 2)
			return `${from === a ? `M${a.x},${a.y} ` : ''}Q${control.x},${control.y} ${to.x},${to.y}`
		}
		const limit = MAX_BOW * length
		const measured = props.bows?.[k]
		const bow = measured?.bowPx ?? 0
		return {
			range: `${curve(limit)} ${curve(-limit, b, a)}`,
			curve: measured?.clear ? curve(bow) : null,
			atLimit: Math.abs(bow) >= limit - 1,
			text: !measured ? null : measured.clear ? `${Math.abs(bow).toFixed(0)} px · ${((Math.abs(bow) / length) * 100).toFixed(1)} %` : 'no edge',
			label: at(bow + 26 / displayScale.value),
		}
	}),
)

function onLoad(event: Event) {
	const img = event.target as HTMLImageElement
	photo.value = img
	natural.value = { width: img.naturalWidth, height: img.naturalHeight }
	updateScale()
	emit('loaded', natural.value)
}

// fit the (turned) photo into the available width and 75 % of the window height
function updateScale() {
	const available = frame.value?.parentElement?.clientWidth ?? 0
	const { width, height } = natural.value
	if (!width || !available) return
	const [w, h] = sideways.value ? [height, width] : [width, height]
	displayScale.value = Math.min(available / w, (window.innerHeight * 0.75) / h)
}
watch(sideways, updateScale)

const resizeObserver = new ResizeObserver(updateScale)
onMounted(() => resizeObserver.observe(frame.value!.parentElement!))
onBeforeUnmount(() => resizeObserver.disconnect())

const frameStyle = computed(() => {
	const { width, height } = natural.value
	const [w, h] = sideways.value ? [height, width] : [width, height]
	return { width: `${w * displayScale.value}px`, height: `${h * displayScale.value}px` }
})
const viewStyle = computed(() => ({
	width: `${natural.value.width * displayScale.value}px`,
	height: `${natural.value.height * displayScale.value}px`,
	transform: `translate(-50%, -50%) rotate(${props.turns * 90}deg)`,
}))

// a screen vector (css px) → photo vector (photo px): undo the view's turn and scale
function toPhoto(x: number, y: number): Point {
	const angle = (props.turns * Math.PI) / 2
	const [cos, sin] = [Math.round(Math.cos(angle)), Math.round(Math.sin(angle))]
	return { x: (x * cos + y * sin) / displayScale.value, y: (-x * sin + y * cos) / displayScale.value }
}

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
	if (!quad.value || event.button !== 0 || (event.target as HTMLElement).closest('button')) return
	event.preventDefault()
	const rect = frame.value!.getBoundingClientRect()
	const fromCenter = toPhoto(event.clientX - rect.left - rect.width / 2, event.clientY - rect.top - rect.height / 2)
	const pointer = { x: natural.value.width / 2 + fromCenter.x, y: natural.value.height / 2 + fromCenter.y }
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
	const speed = event.shiftKey ? 0.1 : 1
	const move = toPhoto(dx * speed, dy * speed)
	const clamp = (value: number, max: number) => Math.min(Math.max(value, 0), max)
	dragPoint = {
		x: clamp(dragPoint.x + move.x, natural.value.width),
		y: clamp(dragPoint.y + move.y, natural.value.height),
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
	// arrows move on screen: turned back into the photo, in whole photo px
	const move = toPhoto(delta[0]! * displayScale.value, delta[1]! * displayScale.value)
	loupeVisible.value = true
	setCorner(selected.value, { x: corner.x + Math.round(move.x), y: corner.y + Math.round(move.y) })
}
onMounted(() => window.addEventListener('keydown', onKey))
onBeforeUnmount(() => window.removeEventListener('keydown', onKey))

// v-model updates arrive after the parent re-renders, so draw from a post-flush watcher, not right after setting
watch([quad, selected, loupeVisible], () => loupeVisible.value && drawLoupe(), { flush: 'post' })

function drawLoupe() {
	const canvas = loupe.value
	const img = frame.value?.querySelector('img')
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
// (in photo coordinates: it turns along with the view)
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
	<div
		id="corner-editor"
		ref="frame"
		:class="{ dragging }"
		:style="frameStyle"
		@pointerdown="startDrag"
		@pointermove="drag"
		@pointerup="endDrag"
		@pointercancel="endDrag"
	>
		<div class="view" :style="viewStyle">
		<img :src="props.src" alt="captured photo" draggable="false" @load="onLoad" @dragstart.prevent />
		<OverexposureMarks :image="photo" />
		<svg v-if="natural.width && quad" :viewBox="`0 0 ${natural.width} ${natural.height}`" preserveAspectRatio="none">
			<polygon :points="points" />
			<g v-for="(side, index) in sides" :key="index">
				<path class="range" :d="side.range" />
				<path v-if="side.curve" class="curve" :d="side.curve" />
				<text
					v-if="side.text"
					:class="{ limit: side.atLimit }"
					:x="side.label.x"
					:y="side.label.y"
					:font-size="14 / displayScale"
					:transform="`rotate(${-props.turns * 90} ${side.label.x} ${side.label.y})`"
				>{{ side.text }}</text>
			</g>
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
		<canvas v-show="loupeVisible" ref="loupe" class="loupe" :style="loupeStyle" />
		</div>
		<button type="button" class="turn left" title="Turn left (painting photographed sideways)" @click="emit('turn', -1)">↺</button>
		<button type="button" class="turn right" title="Turn right (painting photographed sideways)" @click="emit('turn', 1)">↻</button>
	</div>
</template>

<style>
#corner-editor {
	position: relative;
	overflow: hidden;
	touch-action: none;
	user-select: none;
	cursor: crosshair;

	&.dragging {
		cursor: none;
	}

	& .view {
		position: absolute;
		left: 50%;
		top: 50%;
	}

	& img {
		display: block;
		width: 100%;
		height: 100%;
	}

	& .turn {
		position: absolute;
		bottom: var(--gap);
		width: 3.5rem;
		height: 3.5rem;
		border-radius: 50%;
		font-size: 2rem;
		line-height: 1;
		opacity: 0.6;
		cursor: pointer;

		&:hover {
			opacity: 0.9;
		}

		&.left {
			left: var(--gap);
		}

		&.right {
			right: var(--gap);
		}
	}

	& svg {
		position: absolute;
		inset: 0;
		width: 100%;
		height: 100%;
		overflow: visible;

		& polygon {
			fill: none;
			stroke: rgb(255, 220, 0);
			stroke-width: 1.5px;
			vector-effect: non-scaling-stroke;
		}

		& path {
			fill: none;
			vector-effect: non-scaling-stroke;

			&.range {
				stroke: rgba(255, 220, 0, 0.5);
				stroke-width: 1px;
				stroke-dasharray: 4 4;
			}

			&.curve {
				stroke: rgb(0, 255, 255);
				stroke-width: 2px;
			}
		}

		& text {
			fill: #fff;
			stroke: #000;
			stroke-width: 3px;
			paint-order: stroke;
			text-anchor: middle;
			dominant-baseline: middle;
			vector-effect: non-scaling-stroke;

			&.limit {
				fill: #f66;
			}
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

	& .loupe {
		position: absolute;
		border-radius: 50%;
		border: 2px solid #fff;
		box-shadow: 0 0 0 1px #000, 0 4px 16px rgba(0, 0, 0, 0.5);
		pointer-events: none;
	}
}
</style>
