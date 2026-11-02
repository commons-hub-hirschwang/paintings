<script setup lang="ts">
// Local-only capture session (registered in dev builds only): capture → corners → title/size → save.
import { computed, ref } from 'vue'
import CornerEditor from '@/components/CornerEditor.vue'
import { bridge, type BridgeStatus } from '@/bridge'
import { estimateSizeCm, type Quad } from '../../shared/geometry'

const CONFIRMED = 'capture:calibration-confirmed'

const status = ref<BridgeStatus | null>(null)
const askReuse = ref(false)
const photo = ref<string | null>(null)
const quad = ref<Quad | null>(null)
let photoSize = { width: 0, height: 0 }
let lastQuad: { quad: Quad; width: number; height: number } | null = null
const title = ref('')
const widthCm = ref<number | ''>('')
const heightCm = ref<number | ''>('')
const busy = ref('')
const error = ref('')
const saved = ref<{ id: string; title: string; widthCm: number; heightCm: number }[]>([])

async function run(label: string, task: () => Promise<void>) {
	busy.value = label
	error.value = ''
	try {
		await task()
	} catch (e) {
		error.value = (e as Error).message
	} finally {
		busy.value = ''
	}
}

const refreshStatus = () =>
	run('Connecting to bridge…', async () => {
		status.value = await bridge.status()
		askReuse.value = !!status.value.calibration && sessionStorage.getItem(CONFIRMED) !== 'yes'
	})
refreshStatus()

async function answerReuse(reuse: boolean) {
	if (!reuse) await run('Resetting calibration…', () => bridge.forgetCalibration().then(refreshStatus))
	sessionStorage.setItem(CONFIRMED, 'yes')
	askReuse.value = false
}

const calibration = computed(() => status.value?.calibration ?? null)
const measured = computed(() => Number(widthCm.value) > 0 && Number(heightCm.value) > 0)
const estimate = computed(() => (quad.value && calibration.value ? estimateSizeCm(quad.value, calibration.value) : null))
const canSave = computed(() => !!photo.value && !!quad.value && !busy.value && (measured.value || !!calibration.value))

const capture = () => run('Capturing…', async () => setPhoto((await bridge.capture()).file))

function upload(event: Event) {
	const file = (event.target as HTMLInputElement).files?.[0]
	if (file) run('Uploading…', async () => setPhoto((await bridge.upload(file)).file))
}

function setPhoto(file: string) {
	quad.value = null
	photo.value = file
}

// reuse the previous corners when the photo has the same size: paintings sit at the same spot
function onPhotoLoaded({ width, height }: { width: number; height: number }) {
	photoSize = { width, height }
	if (lastQuad && lastQuad.width === width && lastQuad.height === height) {
		quad.value = lastQuad.quad
		return
	}
	const inset = (x: number, y: number) => ({ x: width * x, y: height * y })
	quad.value = [inset(0.15, 0.15), inset(0.85, 0.15), inset(0.85, 0.85), inset(0.15, 0.85)]
}

const save = () =>
	run('Rectifying and uploading…', async () => {
		const result = await bridge.process({
			file: photo.value!,
			quad: quad.value!,
			title: title.value.trim(),
			...(measured.value ? { widthCm: Number(widthCm.value), heightCm: Number(heightCm.value) } : {}),
		})
		lastQuad = { quad: quad.value!, ...photoSize }
		saved.value.unshift({ id: result.id, title: title.value.trim(), widthCm: result.widthCm, heightCm: result.heightCm })
		if (measured.value) {
			sessionStorage.setItem(CONFIRMED, 'yes')
			status.value = await bridge.status()
		}
		photo.value = null
		quad.value = null
		title.value = ''
		widthCm.value = heightCm.value = ''
	})

const thumbUrl = (id: string) => `${status.value?.galleryUrl}/img/${id}/thumb.jpg?v=${id}`
const cm = (value: number) => value.toFixed(1)
</script>

<template>
	<main id="capture">
		<header>
			<h1>Capture</h1>
			<span v-if="status" class="muted">
				Camera: {{ status.cameras[0] ?? 'none detected' }} ·
				{{ calibration ? `calibrated, ${calibration.pxPerCm.toFixed(2)} px/cm` : 'not calibrated' }} · publishing to
				{{ status.galleryUrl }}
			</span>
			<button @click="refreshStatus">Refresh</button>
		</header>

		<p v-if="error" class="error">{{ error }}</p>
		<p v-if="busy" class="muted">{{ busy }}</p>

		<section v-if="askReuse" class="dialog">
			<p>Same distance from camera to painting as before? (reuse calibration)</p>
			<button @click="answerReuse(true)">Yes, reuse</button>
			<button @click="answerReuse(false)">No, measure again</button>
		</section>

		<template v-else-if="status">
			<section v-if="!photo" class="actions">
				<button :disabled="!!busy || !status.cameras.length" @click="capture">Capture with camera</button>
				<label class="button">
					Upload photo
					<input type="file" accept="image/jpeg" hidden @change="upload" />
				</label>
			</section>

			<section v-else class="editor">
				<CornerEditor v-model="quad" :src="bridge.rawUrl(photo)" @loaded="onPhotoLoaded" />

				<form @submit.prevent="canSave && save()">
					<p class="muted">Drag the corners onto the painting's edges. Keys 1–4 select a corner, arrows nudge it (Shift: 10 px).</p>
					<label>
						Title
						<input v-model="title" placeholder="Untitled" autofocus />
					</label>
					<p v-if="!calibration" class="warning">
						First painting of this session: measure it. This calibrates all following paintings — don't move the camera,
						change zoom or the painting position afterwards.
					</p>
					<p v-else-if="estimate">
						Size: {{ cm(estimate.widthCm) }} × {{ cm(estimate.heightCm) }} cm
						<span class="muted">(from calibration; entering a measured size recalibrates)</span>
					</p>
					<div class="size">
						<label>
							Width (cm)
							<input v-model="widthCm" type="number" min="1" step="0.1" :required="!calibration" />
						</label>
						<label>
							Height (cm)
							<input v-model="heightCm" type="number" min="1" step="0.1" :required="!calibration" />
						</label>
					</div>
					<div class="actions">
						<button type="submit" :disabled="!canSave">Save painting</button>
						<button type="button" :disabled="!!busy" @click="photo = null">Discard photo</button>
					</div>
				</form>
			</section>

			<section v-if="saved.length" class="saved">
				<h2>This session ({{ saved.length }})</h2>
				<figure v-for="painting in saved" :key="painting.id">
					<img :src="thumbUrl(painting.id)" :alt="painting.title" />
					<figcaption>
						{{ painting.title || 'Untitled' }}
						<span class="muted">{{ cm(painting.widthCm) }} × {{ cm(painting.heightCm) }} cm</span>
					</figcaption>
				</figure>
			</section>
		</template>
	</main>
</template>

<style>
#capture {
	display: flex;
	flex-direction: column;
	gap: var(--gap);

	& header {
		display: flex;
		flex-wrap: wrap;
		align-items: baseline;
		gap: var(--gap);
	}

	& .editor {
		display: flex;
		flex-wrap: wrap;
		align-items: flex-start;
		gap: var(--gap);

		& form {
			flex: 1 1 18rem;
			display: flex;
			flex-direction: column;
			gap: var(--gap);
		}
	}

	& .size {
		display: flex;
		gap: var(--gap);
	}

	& .saved {
		display: grid;
		grid-template-columns: repeat(auto-fill, minmax(8rem, 1fr));
		gap: var(--gap);

		& h2 {
			grid-column: 1 / -1;
		}

		& figure {
			margin: 0;
		}

		& img {
			width: 100%;
			aspect-ratio: 1;
			object-fit: contain;
		}

		& figcaption {
			display: flex;
			flex-direction: column;
		}
	}
}
</style>
