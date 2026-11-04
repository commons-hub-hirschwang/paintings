<script setup lang="ts">
// Red diagonal stripes over the overexposed parts of a shown photo (any channel at its maximum: no detail left there).
// Sits on top of the image and turns with it. A faint tint between the stripes keeps small spots visible.
import { ref, watch } from 'vue'

const props = defineProps<{ image: HTMLImageElement | null }>()
const emit = defineEmits<{ share: [share: number] }>()
const canvas = ref<HTMLCanvasElement>()

const WIDTH = 1600 // marks are computed at this size, not at the photo's
const STRIPE_EVERY = 18
const STRIPE_WIDTH = 6

function draw() {
	const image = props.image
	const target = canvas.value
	if (!image || !target || !image.naturalWidth) return
	const scale = Math.min(1, WIDTH / image.naturalWidth)
	const width = (target.width = Math.round(image.naturalWidth * scale))
	const height = (target.height = Math.round(image.naturalHeight * scale))
	const context = target.getContext('2d', { willReadFrequently: true })!
	context.drawImage(image, 0, 0, width, height)
	const pixels = context.getImageData(0, 0, width, height)
	const { data } = pixels
	let clipped = 0
	for (let y = 0, i = 0; y < height; y++) {
		for (let x = 0; x < width; x++, i += 4) {
			const over = data[i]! >= 254 || data[i + 1]! >= 254 || data[i + 2]! >= 254
			if (over) clipped++
			data[i] = 255
			data[i + 1] = 0
			data[i + 2] = 0
			data[i + 3] = !over ? 0 : (x + y) % STRIPE_EVERY < STRIPE_WIDTH ? 230 : 60
		}
	}
	context.putImageData(pixels, 0, 0)
	emit('share', clipped / (width * height))
}
watch(() => props.image, draw, { flush: 'post' })
watch(canvas, draw)
</script>

<template>
	<canvas ref="canvas" class="overexposure-marks" />
</template>

<style>
.overexposure-marks {
	position: absolute;
	inset: 0;
	width: 100%;
	height: 100%;
	pointer-events: none;
}
</style>
