<script setup lang="ts">
// Set the 4 painting corners: hovering magnifies the nearest corner (or the middle of a side, when nearer: to check the edge),
// in a loupe that is magnified in its centre and squeezes more and more of the surroundings towards its rim. Press anywhere and it moves with the mouse
// (cursor hidden, slowing to 1/10 speed over 10 s of dragging, Shift = another 1/10). Arrow keys nudge the selected corner by 1 px (Shift: 10 px), keys 1–4 select.
// The view can be turned in quarter turns (painting photographed sideways, buttons in the parent): the parent turns the corner order
// along (turnCorners), the photo itself stays as it is; all screen input is turned back into photo coordinates.
// Each side shows its measured curve (bows, true to scale) and the range it may curve in.
import { computed, onBeforeUnmount, onMounted, ref, shallowRef, watch } from 'vue'
import OverexposureMarks from './OverexposureMarks.vue'
import type { Bow } from './bridge'
import { MAX_BOW, type Point, type Quad } from '../shared/geometry'

const props = defineProps<{ src: string; turns: number; bows: Bow[] | null }>() // turns: clockwise quarter turns of the view
const quad = defineModel<Quad | null>({ required: true }) // null until the parent sets corners on `loaded`
const emit = defineEmits<{ loaded: [size: { width: number; height: number }] }>()
const photo = shallowRef<HTMLImageElement | null>(null)

const LOUPE = 220 // css px
const ZOOM = 2 // loupe css px per photo px, in its centre
const REACH = 300 // photo px from the loupe's centre to its rim
const FLAT = 4 // how long the magnification holds towards the rim (higher: flatter centre, steeper rim)
const labels = ['top left', 'top right', 'bottom right', 'bottom left']

const frame = ref<HTMLElement>()
const loupe = ref<HTMLCanvasElement>()
const natural = ref({ width: 0, height: 0 })
const displayScale = ref(1) // css px per photo px
const sideways = computed(() => props.turns % 2 === 1)
const selected = ref(0)
// hovering nearer to the middle of a side than to any corner: that side is shown in the loupe (pressing still grabs the corner)
const hoveredSide = ref<number | null>(null)
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
			a,
			b,
			// the measured curve's control point; its apex (the middle of the edge) lies halfway out
			control: measured?.clear ? at(bow * 2) : null,
			apex: at(measured?.clear ? bow : 0),
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

// Hover: the nearest corner is selected and shown magnified. Press anywhere: it follows the pointer
// *relatively* (no jump), with the cursor hidden (pointer lock). The longer the drag, the finer: the speed falls
// evenly (exponentially) to 1/10 within 10 s — coarse first, then precise. Shift: another 1/10.
let dragPoint: Point = { x: 0, y: 0 } // local, since v-model updates lag one render behind
let lastClient: Point = { x: 0, y: 0 }
let dragStart = 0 // event.timeStamp
const SLOWDOWN = { seconds: 10, to: 0.1 }
const dragSpeed = (timeStamp: number) =>
	SLOWDOWN.to ** Math.min((timeStamp - dragStart) / 1000 / SLOWDOWN.seconds, 1)

// the corner nearest to the pointer, in photo coordinates
function nearestCorner(event: PointerEvent) {
	const pointer = pointerInPhoto(event)
	const distances = quad.value!.map((corner) => Math.hypot(corner.x - pointer.x, corner.y - pointer.y))
	return distances.indexOf(Math.min(...distances))
}

function startDrag(event: PointerEvent) {
	if (!quad.value || event.button !== 0) return
	event.preventDefault()
	selected.value = nearestCorner(event)
	hoveredSide.value = null
	dragPoint = { ...quad.value[selected.value]! }
	lastClient = { x: event.clientX, y: event.clientY }
	dragStart = event.timeStamp
	dragging.value = true
	loupeVisible.value = true
	const editor = event.currentTarget as HTMLElement
	editor.setPointerCapture(event.pointerId)
	if (event.pointerType === 'mouse') Promise.resolve(editor.requestPointerLock()).catch(() => {})
}

// the pointer in photo coordinates
function pointerInPhoto(event: PointerEvent): Point {
	const rect = frame.value!.getBoundingClientRect()
	const fromCenter = toPhoto(event.clientX - rect.left - rect.width / 2, event.clientY - rect.top - rect.height / 2)
	return { x: natural.value.width / 2 + fromCenter.x, y: natural.value.height / 2 + fromCenter.y }
}

// hovering already selects the corner a press would grab and shows it magnified; nearer to a side's middle: that one
function hover(event: PointerEvent) {
	if (!quad.value || event.pointerType !== 'mouse') return
	const corner = nearestCorner(event)
	const pointer = pointerInPhoto(event)
	const distance = (p: Point) => Math.hypot(p.x - pointer.x, p.y - pointer.y)
	const middles = sides.value.map((side) => distance(side.apex))
	const side = middles.indexOf(Math.min(...middles))
	if (middles[side]! < distance(quad.value[corner]!)) hoveredSide.value = side
	else {
		hoveredSide.value = null
		selected.value = corner
	}
	loupeVisible.value = true
}

function leave() {
	if (dragging.value) return
	loupeVisible.value = false
	hoveredSide.value = null
}

function drag(event: PointerEvent) {
	if (!dragging.value) return hover(event)
	// locked mouse: clientX is frozen, use movementX; touch/pen: client deltas
	const locked = document.pointerLockElement !== null
	const dx = locked ? event.movementX : event.clientX - lastClient.x
	const dy = locked ? event.movementY : event.clientY - lastClient.y
	lastClient = { x: event.clientX, y: event.clientY }
	const speed = dragSpeed(event.timeStamp) * (event.shiftKey ? 0.1 : 1)
	const move = toPhoto(dx * speed, dy * speed)
	const clamp = (value: number, max: number) => Math.min(Math.max(value, 0), max)
	dragPoint = {
		x: clamp(dragPoint.x + move.x, natural.value.width),
		y: clamp(dragPoint.y + move.y, natural.value.height),
	}
	setCorner(selected.value, dragPoint)
}

function endDrag(event: PointerEvent) {
	if (!dragging.value) return
	dragging.value = false
	if (event.pointerType !== 'mouse') loupeVisible.value = false // a mouse still hovers: keep it
	if (document.pointerLockElement) document.exitPointerLock()
}

function onKey(event: KeyboardEvent) {
	if (event.target instanceof HTMLInputElement || !quad.value) return
	if (['1', '2', '3', '4'].includes(event.key)) {
		selected.value = Number(event.key) - 1
		hoveredSide.value = null
		loupeVisible.value = true
		return
	}
	const step = event.shiftKey ? 10 : 1
	const delta = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] }[event.key]
	// Esc hides the loupe first; only without one does it reach the page (which closes an opened painting)
	if (event.key === 'Escape' && loupeVisible.value) {
		loupeVisible.value = false
		event.stopImmediatePropagation()
	}
	if (!delta) return
	event.preventDefault()
	const corner = quad.value[selected.value]!
	// arrows move on screen: turned back into the photo, in whole photo px
	const move = toPhoto(delta[0]! * displayScale.value, delta[1]! * displayScale.value)
	loupeVisible.value = true
	hoveredSide.value = null
	setCorner(selected.value, { x: corner.x + Math.round(move.x), y: corner.y + Math.round(move.y) })
}
// capture phase: ahead of the page's own key handling
onMounted(() => window.addEventListener('keydown', onKey, true))
onBeforeUnmount(() => window.removeEventListener('keydown', onKey, true))

// v-model updates arrive after the parent re-renders, so draw from a post-flush watcher, not right after setting
watch([quad, selected, hoveredSide, loupeVisible, () => props.bows], () => loupeVisible.value && drawLoupe(), { flush: 'post' })

// what the loupe is centred on: the selected corner, or the middle of the hovered side
const loupeCenter = computed(() => (hoveredSide.value !== null ? sides.value[hoveredSide.value]?.apex : quad.value?.[selected.value]) ?? null)

// Reverse fisheye: loupe radius r (css px from its centre) shows the photo at `reach(r)` photo px from the centre:
// ZOOM× in the middle, squeezing towards the rim, which reaches REACH. Radial, so lines through the centre stay straight
const RADIUS = LOUPE / 2
const reach = (r: number) => r / ZOOM + (REACH - RADIUS / ZOOM) * (r / RADIUS) ** FLAT
const rimSlope = 1 / ZOOM + (FLAT * (REACH - RADIUS / ZOOM)) / RADIUS // photo px per css px at the rim
// the inverse, by bisection (reach grows monotonically); beyond the rim: on outwards, clipped anyway
function radiusFor(distance: number) {
	if (distance >= REACH) return RADIUS + (distance - REACH) / rimSlope
	let [low, high] = [0, RADIUS]
	for (let i = 0; i < 30; i++) {
		const middle = (low + high) / 2
		if (reach(middle) < distance) low = middle
		else high = middle
	}
	return (low + high) / 2
}

// per loupe pixel (device px, fixed for a size), the photo offset from the centre; NaN: outside the circle
let lookup: { size: number; dx: Float32Array; dy: Float32Array } | null = null
function lookupFor(size: number, dpr: number) {
	if (lookup?.size === size) return lookup
	const dx = new Float32Array(size * size)
	const dy = new Float32Array(size * size)
	for (let y = 0; y < size; y++)
		for (let x = 0; x < size; x++) {
			const [ox, oy] = [(x + 0.5) / dpr - RADIUS, (y + 0.5) / dpr - RADIUS]
			const r = Math.hypot(ox, oy)
			const scale = r > RADIUS ? NaN : r ? reach(r) / r : 1 / ZOOM
			dx[y * size + x] = ox * scale
			dy[y * size + x] = oy * scale
		}
	return (lookup = { size, dx, dy })
}

const source = document.createElement('canvas')
function drawLoupe() {
	const canvas = loupe.value
	const img = frame.value?.querySelector('img')
	const center = loupeCenter.value
	if (!canvas || !img || !quad.value || !center) return
	const dpr = window.devicePixelRatio
	const size = Math.round(LOUPE * dpr)
	canvas.width = canvas.height = size
	const ctx = canvas.getContext('2d')!

	// the photo around the centre, unscaled (black outside the photo), remapped pixel by pixel (nearest: crisp)
	const [left, top] = [Math.floor(center.x) - REACH - 1, Math.floor(center.y) - REACH - 1]
	const span = 2 * REACH + 3
	source.width = source.height = span
	const sctx = source.getContext('2d', { willReadFrequently: true })!
	sctx.fillStyle = '#000'
	sctx.fillRect(0, 0, span, span)
	sctx.drawImage(img, left, top, span, span, 0, 0, span, span)
	const from = sctx.getImageData(0, 0, span, span).data
	const out = ctx.createImageData(size, size)
	const { dx, dy } = lookupFor(size, dpr)
	const [cx, cy] = [center.x - left, center.y - top]
	for (let i = 0; i < size * size; i++) {
		if (Number.isNaN(dx[i]!)) continue
		const sx = Math.min(Math.max(Math.floor(cx + dx[i]!), 0), span - 1)
		const sy = Math.min(Math.max(Math.floor(cy + dy[i]!), 0), span - 1)
		const s = (sy * span + sx) * 4
		const o = i * 4
		out.data[o] = from[s]!
		out.data[o + 1] = from[s + 1]!
		out.data[o + 2] = from[s + 2]!
		out.data[o + 3] = 255
	}
	ctx.putImageData(out, 0, 0)

	// lines in the photo, through the same distortion (sampled finely: off-centre lines bend)
	const toLoupe = (p: Point) => {
		const [ox, oy] = [p.x - center.x, p.y - center.y]
		const distance = Math.hypot(ox, oy)
		const r = distance ? radiusFor(distance) / distance : ZOOM
		return { x: (RADIUS + ox * r) * dpr, y: (RADIUS + oy * r) * dpr }
	}
	const trace = (pointAt: (t: number) => Point) => {
		ctx.beginPath()
		for (let k = 0; k <= 1000; k++) {
			const p = toLoupe(pointAt(k / 1000))
			if (k) ctx.lineTo(p.x, p.y)
			else ctx.moveTo(p.x, p.y)
		}
		ctx.stroke()
	}
	ctx.save()
	ctx.beginPath()
	ctx.arc(RADIUS * dpr, RADIUS * dpr, RADIUS * dpr, 0, 2 * Math.PI)
	ctx.clip()
	ctx.lineWidth = dpr
	const shown = hoveredSide.value !== null ? [hoveredSide.value] : [(selected.value + 3) % 4, selected.value]
	for (const k of shown) {
		const { a, b, control } = sides.value[k]!
		// the corners' straight side
		ctx.strokeStyle = 'rgba(255, 220, 0, 0.8)'
		trace((t) => ({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t }))
		// the measured edge
		if (control) {
			ctx.strokeStyle = 'rgba(0, 255, 255, 0.8)'
			trace((t) => ({
				x: (1 - t) ** 2 * a.x + 2 * (1 - t) * t * control.x + t ** 2 * b.x,
				y: (1 - t) ** 2 * a.y + 2 * (1 - t) * t * control.y + t ** 2 * b.y,
			}))
		}
	}
	// crosshair
	ctx.strokeStyle = '#f0f'
	ctx.beginPath()
	ctx.moveTo(size / 2, 0)
	ctx.lineTo(size / 2, size)
	ctx.moveTo(0, size / 2)
	ctx.lineTo(size, size / 2)
	ctx.stroke()
	ctx.restore()
}

// loupe sits diagonally away from the corner, towards the photo's center, so it never covers the corner
// (in photo coordinates: it turns along with the view)
const loupeStyle = computed(() => {
	const corner = loupeCenter.value
	if (!corner) return {}
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
		@pointerleave="leave"
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
