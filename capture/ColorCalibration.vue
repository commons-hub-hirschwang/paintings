<script setup lang="ts">
// Colour calibration: reference photo of a painting → drag a box over a white area → the bridge sets exposure and
// white balance from it. Prefilled with the last area: the same painting and spot keep sessions comparable.
import { computed, ref, shallowRef } from 'vue'
import OverexposureMarks from './OverexposureMarks.vue'
import { bridge, type Box, type ColorCalibration } from './bridge'

const props = defineProps<{
	run: (label: string, task: () => Promise<void>) => Promise<void>
	busy: boolean
	previous: ColorCalibration | null
}>()
const emit = defineEmits<{ done: []; cancel: [] }>()

const file = ref<string | null>(null)
const box = ref<Box | null>(props.previous?.box ?? null)
const natural = ref({ width: 0, height: 0 })
const result = ref<ColorCalibration | null>(null)
// ISO: a higher one shortens the exposure, at some noise. Used for the next reference photo
const isoChoices = [100, 200, 400, 800]
const iso = ref(props.previous?.iso ?? 400)
// how bright the marked white becomes (0–255)
const whiteLevel = ref(props.previous?.target ?? 242)
const shown = shallowRef<HTMLImageElement | null>(null)
const overexposed = ref(0)
const last = computed(() => result.value ?? props.previous)
const canCalibrate = computed(() => !!file.value && !!box.value && box.value.width >= 8 && box.value.height >= 8)

function again() {
	result.value = null
	file.value = null
	shown.value = null
	overexposed.value = 0
}

const takeReference = () =>
	props.run('Taking the reference photo (finding the exposure, up to 1 min)…', async () => {
		file.value = (await bridge.colorReference(iso.value)).file
	})

const calibrate = () =>
	props.run('Calibrating: setting exposure and white balance, a few more photos…', async () => {
		result.value = await bridge.calibrateColor(file.value!, box.value!, whiteLevel.value)
	})

function onLoad(event: Event) {
	const image = event.target as HTMLImageElement
	shown.value = image
	if (!result.value) natural.value = { width: image.naturalWidth, height: image.naturalHeight }
}

let start: { x: number; y: number } | null = null
function toPhoto(event: PointerEvent) {
	const rect = (event.currentTarget as HTMLElement).getBoundingClientRect()
	const clamp = (value: number) => Math.min(Math.max(value, 0), 1)
	return {
		x: clamp((event.clientX - rect.left) / rect.width) * natural.value.width,
		y: clamp((event.clientY - rect.top) / rect.height) * natural.value.height,
	}
}
function press(event: PointerEvent) {
	;(event.currentTarget as HTMLElement).setPointerCapture(event.pointerId)
	start = toPhoto(event)
}
function move(event: PointerEvent) {
	if (!start) return
	const { x, y } = toPhoto(event)
	box.value = { left: Math.min(x, start.x), top: Math.min(y, start.y), width: Math.abs(x - start.x), height: Math.abs(y - start.y) }
}
</script>

<template>
	<section id="color-calibration">
		<template v-if="result">
			<p>
				Calibrated: {{ result.shutter }} s, f/{{ result.fNumber }}, ISO {{ result.iso }}, {{ result.kelvin }} K. The marked white now
				reads {{ result.white }} of 255. This is how paintings will look: compare it with the real painting.
			</p>
			<p v-for="warning in result.warnings" :key="warning" class="warning">{{ warning }}</p>
			<p v-if="overexposed" class="warning">Overexposed: red stripes mark what has lost its detail (only the painting matters).</p>
			<div class="actions">
				<button :disabled="busy" @click="emit('done')">Use this</button>
				<button :disabled="busy" @click="again">Calibrate again</button>
			</div>
			<div class="photo result">
				<img :src="bridge.colorImageUrl('reference.jpg', result.createdAt)" alt="the calibrated photo" draggable="false" @load="onLoad" />
				<OverexposureMarks :image="shown" @share="overexposed = $event" />
				<svg v-if="natural.width" :viewBox="`0 0 ${natural.width} ${natural.height}`" preserveAspectRatio="none">
					<rect :x="result.box.left" :y="result.box.top" :width="result.box.width" :height="result.box.height" />
				</svg>
			</div>
		</template>
		<template v-else-if="!file">
			<p>
				Put a painting with a clean white area in the usual spot, under the light you'll use.
				{{ last ? 'Use the same painting and area as last time:' : 'Remember which one: use the same one whenever you recalibrate.' }}
			</p>
			<img v-if="last" class="previous" :src="bridge.colorImageUrl('reference.jpg', last.createdAt)" alt="the painting of the last calibration" />
			<label>
				ISO
				<select v-model.number="iso" :disabled="busy">
					<option v-for="choice in isoChoices" :key="choice" :value="choice">{{ choice }}</option>
				</select>
				<span class="muted">Higher: shorter exposure, a little more noise. Every step halves the exposure time.</span>
			</label>
			<div class="actions">
				<button :disabled="busy" @click="takeReference">Take reference photo</button>
				<button :disabled="busy" @click="emit('cancel')">Cancel</button>
			</div>
		</template>
		<template v-else>
			<p>Drag a box over the white area: even, without brush marks or glare. Pick the cleanest white, as it becomes neutral for every painting.</p>
			<label>
				White level
				<input v-model.number="whiteLevel" type="number" min="180" max="248" :disabled="busy" />
				<span class="muted">of 255. Higher: brighter whites, but less room for anything brighter than this white.</span>
			</label>
			<div class="actions">
				<button :disabled="busy || !canCalibrate" @click="calibrate">Calibrate from this area</button>
				<button :disabled="busy" @click="takeReference">New photo</button>
				<button :disabled="busy" @click="emit('cancel')">Cancel</button>
			</div>
			<div class="photo" @pointerdown="press" @pointermove="move" @pointerup="start = null" @pointercancel="start = null">
				<img :key="file" :src="bridge.colorShotUrl(file)" alt="reference photo" draggable="false" @load="onLoad" />
				<OverexposureMarks :image="shown" />
				<svg v-if="box && natural.width" :viewBox="`0 0 ${natural.width} ${natural.height}`" preserveAspectRatio="none">
					<rect :x="box.left" :y="box.top" :width="box.width" :height="box.height" />
				</svg>
			</div>
		</template>
	</section>
</template>

<style>
#color-calibration {
	display: flex;
	flex-direction: column;
	align-items: flex-start;
	gap: var(--gap);

	& .previous {
		max-width: 24rem;
	}

	& .photo {
		position: relative;
		touch-action: none;
		user-select: none;
		cursor: crosshair;

		&.result {
			cursor: default;
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
		}

		& rect {
			fill: none;
			stroke: rgb(255, 0, 255);
			stroke-width: 2px;
			vector-effect: non-scaling-stroke;
		}
	}
}
</style>
