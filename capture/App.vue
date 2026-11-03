<script setup lang="ts">
// Local capture tool (pnpm capture): project → capture → corners → title/size → save offline → sync.
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import CornerEditor from './CornerEditor.vue'
import { bridge, type BridgeStatus, type Detection, type LocalPainting, type Photo } from './bridge'
import { estimateSizeCm, reconstruct, turnCorners, type Camera, type Quad } from '../shared/geometry'

const confirmedKey = () => `capture:calibration-confirmed:${status.value?.project}`
const newProject = ref('')

const status = ref<BridgeStatus | null>(null)
const askReuse = ref(false)
const photo = ref<string | null>(null)
// corners in the painting's orientation: TL is the painting's top left, also when photographed sideways
const quad = ref<Quad | null>(null)
// view turned clockwise in quarter turns; kept for the next photos (a series photographed the same way)
const turns = ref(0)
// automatic corners (in the painting's orientation); its curved-edge correction applies while its corners are kept
const detection = ref<Detection | null>(null)
const keptDetection = computed(() => !!detection.value && quad.value === detection.value.quad)
const maxBow = computed(() => Math.max(0, ...(detection.value?.sides.map((side) => Math.abs(side.bowPx)) ?? [])))
const camera = ref<Camera | null>(null)
let photoSize = { width: 0, height: 0 }
let lastQuad: { quad: Quad; turns: number; width: number; height: number } | null = null
const title = ref('')
const group = ref('')
const NEW_GROUP = '\u0000new'
// material: stays as chosen for the next paintings; the list: all materials used in this project
const material = ref('')
const NEW_MATERIAL = '\u0000new-material'
const typingMaterial = ref(false)
const materials = computed(() =>
	[...new Set([...paintings.value.map((p) => p.material), ...(typingMaterial.value ? [] : [material.value])])].filter((m): m is string => !!m).sort(),
)
function chooseMaterial(value: string) {
	typingMaterial.value = value === NEW_MATERIAL
	material.value = typingMaterial.value ? '' : value
}
const widthCm = ref<number | ''>('')
const heightCm = ref<number | ''>('')
const busy = ref('')
const error = ref('')
const notice = ref('')
const settings = ref({ galleryUrl: '', uploadKey: '' })

const saveSettings = () =>
	run('Saving settings…', async () => {
		await bridge.saveSettings(settings.value)
		status.value = await bridge.status()
		paintings.value = await bridge.paintings()
		settings.value.uploadKey = ''
	})
const paintings = ref<LocalPainting[]>([])

// settings form shows the current project's sync target
watch(
	() => [status.value?.project, status.value?.galleryUrl],
	() => (settings.value.galleryUrl = status.value?.galleryUrl ?? ''),
)

async function run(label: string, task: () => Promise<void>) {
	busy.value = label
	error.value = ''
	notice.value = ''
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
		paintings.value = status.value.project ? await bridge.paintings() : []
		// keep the chosen group; default: group of the last capture
		if (!status.value.groups?.includes(group.value)) group.value = paintings.value[0]?.group ?? status.value.groups?.[0] ?? ''
		if (!material.value) material.value = paintings.value[0]?.material ?? ''
		askReuse.value = !!status.value.calibration && sessionStorage.getItem(confirmedKey()) !== 'yes'
	})
refreshStatus()

async function answerReuse(reuse: boolean) {
	if (!reuse) await run('Resetting calibration…', () => bridge.forgetCalibration().then(refreshStatus))
	sessionStorage.setItem(confirmedKey(), 'yes')
	askReuse.value = false
}

const openProject = (name: string, create = false) =>
	run('Opening project…', async () => {
		await bridge.openProject(name, create)
		photo.value = null
		lastQuad = null
		newProject.value = ''
		await refreshStatus()
	})

// "New group…" in the select creates the next group (B, C, …) and selects it
function chooseGroup(value: string) {
	if (value !== NEW_GROUP) return (group.value = value)
	run('Creating group…', async () => {
		group.value = (await bridge.addGroup()).group
		status.value = await bridge.status()
	})
}
const nextNumber = computed(() => Math.max(-1, ...paintings.value.filter((p) => p.group === group.value).map((p) => p.number)) + 1)
const label = (p: { group: string; number: number }) => `${p.group} #${p.number}`

const calibration = computed(() => status.value?.calibration ?? null)
const measured = computed(() => Number(widthCm.value) > 0 && Number(heightCm.value) > 0)
const estimate = computed(() =>
	quad.value && calibration.value && camera.value ? estimateSizeCm(quad.value, calibration.value, camera.value) : null,
)
// 3D shape from the corners: tilt of the painting and how far the corner angle is from 90°
const shape = computed(() => (quad.value && camera.value ? reconstruct(quad.value, camera.value) : null))
const canSave = computed(() => !!photo.value && !!quad.value && !busy.value && (measured.value || !!calibration.value))

const capture = () => run('Capturing…', async () => setPhoto(await bridge.capture()))

function upload(event: Event) {
	const file = (event.target as HTMLInputElement).files?.[0]
	if (file) run('Uploading…', async () => setPhoto(await bridge.upload(file)))
}

// the bridge detects in the photo's orientation; turned into the painting's
const turnDetection = (d: Detection, by: number): Detection => ({
	...d,
	quad: turnCorners(d.quad, by) as Quad,
	sides: turnCorners(d.sides, by),
})

function setPhoto(result: Photo) {
	detection.value = result.detection && turnDetection(result.detection, turns.value)
	quad.value = detection.value?.quad ?? null
	camera.value = result.camera
	photo.value = result.file
}

// roughly placed corners → snapped to the painting's edges
const snap = () =>
	run('Snapping to edges…', async () => {
		detection.value = turnDetection(await bridge.detect(photo.value!, quad.value!), turns.value)
		quad.value = detection.value.quad
	})

// painting photographed sideways: turn the view; the corners turn along (same points, new top)
function turn(direction: 1 | -1) {
	turns.value = (turns.value + direction + 4) % 4
	if (keptDetection.value) {
		detection.value = turnDetection(detection.value!, direction)
		quad.value = detection.value.quad
	} else if (quad.value) quad.value = turnCorners(quad.value, direction) as Quad
}
function onKey(event: KeyboardEvent) {
	if (event.key === 's' && !(event.target instanceof HTMLInputElement) && photo.value && quad.value && !busy.value) snap()
}
onMounted(() => window.addEventListener('keydown', onKey))
onBeforeUnmount(() => window.removeEventListener('keydown', onKey))

// without detection: reuse the previous corners when the photo has the same size (paintings sit at the same spot)
function onPhotoLoaded({ width, height }: { width: number; height: number }) {
	photoSize = { width, height }
	if (quad.value) return
	if (lastQuad && lastQuad.width === width && lastQuad.height === height) {
		quad.value = turnCorners(lastQuad.quad, turns.value - lastQuad.turns) as Quad
		return
	}
	const inset = (x: number, y: number) => ({ x: width * x, y: height * y })
	quad.value = [inset(0.15, 0.15), inset(0.85, 0.15), inset(0.85, 0.85), inset(0.15, 0.85)]
}

const save = () =>
	run('Rectifying…', async () => {
		await bridge.process({
			file: photo.value!,
			quad: quad.value!,
			...(keptDetection.value ? { bows: detection.value!.sides.map((side) => side.bowPx) } : {}),
			title: title.value.trim(),
			group: group.value,
			material: material.value.trim(),
			...(measured.value ? { widthCm: Number(widthCm.value), heightCm: Number(heightCm.value) } : {}),
		})
		lastQuad = { quad: quad.value!, turns: turns.value, ...photoSize }
		if (measured.value) sessionStorage.setItem(confirmedKey(), 'yes')
		status.value = await bridge.status()
		paintings.value = await bridge.paintings()
		photo.value = null
		quad.value = null
		title.value = ''
		typingMaterial.value = false
		widthCm.value = heightCm.value = ''
	})

const sync = () =>
	run(`Syncing to ${status.value?.galleryUrl}…`, async () => {
		const { synced, failed } = await bridge.sync()
		notice.value = `${synced} synced to ${status.value?.galleryUrl} (as drafts, not public yet)`
		status.value = await bridge.status()
		paintings.value = await bridge.paintings()
		if (failed.length) error.value = `${failed.length} failed: ${failed[0]!.error}`
	})
const cm = (value: number) => value.toFixed(1)
</script>

<template>
	<main id="capture">
		<header>
			<h1>Capture</h1>
			<select v-if="status?.projects.length" :value="status.project ?? ''" @change="openProject(($event.target as HTMLSelectElement).value)">
				<option v-if="!status.project" value="" disabled>Open project…</option>
				<option v-for="project in status.projects" :key="project">{{ project }}</option>
			</select>
			<form class="actions" @submit.prevent="openProject(newProject, true)">
				<input v-model="newProject" placeholder="New project, e.g. attic" required />
				<button type="submit">Create</button>
			</form>
			<span v-if="status?.project" class="muted">
				Camera: {{ status.cameras[0] ?? 'none detected' }} ·
				{{
					calibration
						? calibration.centerDepthCm
							? `calibrated at ${(calibration.centerDepthCm / 100).toFixed(2)} m`
							: `calibrated, ${calibration.pxPerCm.toFixed(2)} px/cm`
						: 'not calibrated'
				}}
			</span>
			<button @click="refreshStatus">Refresh</button>
		</header>


		<p v-if="error" class="error">{{ error }}</p>
		<p v-if="busy" class="muted">{{ busy }}</p>
		<p v-if="notice">{{ notice }}</p>

		<section v-if="askReuse" class="dialog">
			<p>Same distance from camera to painting as before? (reuse calibration)</p>
			<button @click="answerReuse(true)">Yes, reuse</button>
			<button @click="answerReuse(false)">No, measure again</button>
		</section>

		<p v-else-if="status && !status.project" class="muted">Create or open a project to start.</p>

		<template v-else-if="status">
			<section v-if="!photo" class="actions">
				<button :disabled="!!busy || !status.cameras.length" @click="capture">Capture with camera</button>
				<label class="button">
					Upload photo
					<input type="file" accept="image/jpeg" hidden @change="upload" />
				</label>
			</section>

			<section v-else class="editor">
				<CornerEditor v-model="quad" :src="bridge.photoUrl(photo)" :turns="turns" @turn="turn" @loaded="onPhotoLoaded" />

				<form @submit.prevent="canSave && save()">
					<fieldset>
					<legend>Painting</legend>
					<p v-if="keptDetection && detection!.trusted">Corners detected automatically.</p>
					<p v-else-if="keptDetection" class="warning">Detection unsure — check the corners.</p>
					<p v-else-if="!detection" class="warning">No painting edges found — set the corners.</p>
					<p v-if="keptDetection && maxBow > 3" class="muted">
						Edges bow up to {{ maxBow.toFixed(0) }} px (canvas) — straightened.
					</p>
					<p class="muted">
						Press anywhere and move: the nearest corner follows (Shift = slow). Keys 1–4 select a corner, arrows nudge it.
						Rough corners? <button type="button" :disabled="!!busy || !quad" @click="snap">Snap to edges</button> (S)
					</p>
					<div class="name">
						<label>
							Group
							<select :value="group" @change="chooseGroup(($event.target as HTMLSelectElement).value)">
								<option v-for="g in status.groups" :key="g" :value="g">{{ g }}</option>
								<option :value="NEW_GROUP">New group…</option>
							</select>
						</label>
						<span class="number">#{{ nextNumber }}</span>
						<label>
							Name
							<input v-model="title" placeholder="Untitled" autofocus />
						</label>
					</div>
					<div class="name">
						<label>
							Material
							<select :value="typingMaterial ? NEW_MATERIAL : material" @change="chooseMaterial(($event.target as HTMLSelectElement).value)">
								<option v-if="!materials.length && !typingMaterial" value="" disabled>–</option>
								<option v-for="m in materials" :key="m" :value="m">{{ m }}</option>
								<option :value="NEW_MATERIAL">New material…</option>
							</select>
						</label>
						<label v-if="typingMaterial">
							New material
							<input v-model="material" placeholder="e.g. Öl auf Leinwand" autofocus />
						</label>
					</div>
					<p v-if="!calibration" class="warning">
						First painting of this session: measure it. This calibrates all following paintings — don't move the camera,
						change zoom or the painting position afterwards.
					</p>
					<p v-else-if="calibration.centerDepthCm && camera?.lens && !calibration.lensCorrected" class="warning">
						Calibrated before lens correction — measure one painting again for exact sizes.
					</p>
					<p v-if="calibration && estimate">
						Size: {{ cm(estimate.widthCm) }} × {{ cm(estimate.heightCm) }} cm
						<span class="muted">(from calibration; entering a measured size recalibrates)</span>
					</p>
					<p v-if="shape" :class="{ warning: shape.angleErrorDeg > 1.5 }">
						Tilted {{ shape.tiltDeg.toFixed(1) }}° · corners {{ shape.angleErrorDeg.toFixed(1) }}° off square
						<span v-if="shape.angleErrorDeg > 1.5">— check the corners</span>
					</p>
					<p v-else-if="camera && !camera.focalPx" class="muted">No focal length in this photo: size ignores tilt.</p>
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
					</fieldset>
				</form>
			</section>

			<fieldset v-if="paintings.length" class="saved">
				<legend>Captured ({{ paintings.length }})</legend>
				<figure v-for="painting in paintings" :key="painting.id">
					<img :src="bridge.thumbUrl(painting.id)" :alt="painting.title" />
					<figcaption>
						<span><strong>{{ label(painting) }}</strong> {{ painting.title || 'Untitled' }}</span>
						<span class="muted">
							{{ cm(painting.widthCm) }} × {{ cm(painting.heightCm) }} cm ·
							<template v-if="painting.material">{{ painting.material }} · </template>
							{{ painting.isSynced ? 'synced' : 'not synced' }}
						</span>
					</figcaption>
				</figure>
			</fieldset>

			<!-- sync to the website: below the captured paintings -->
			<fieldset class="sync">
				<legend>Sync</legend>
				<p>
					{{ status.unsynced }} not synced to {{ status.galleryUrl }}
					<span :class="status.connection.ok ? 'muted' : 'error'">
						({{ status.connection.ok ? `key "${status.connection.key}"` : status.hasUploadKey ? 'not reachable / key invalid' : 'no upload key' }})
					</span>
				</p>
				<button :disabled="!!busy" @click="sync">Sync {{ status.unsynced || '' }}</button>
				<form @submit.prevent="saveSettings">
					<label>
						Gallery URL
						<input v-model="settings.galleryUrl" placeholder="https://paintings.commons-hub.at" required />
					</label>
					<label>
						Upload key
						<input
							v-model="settings.uploadKey"
							type="password"
							:placeholder="status.hasUploadKey ? 'saved — enter to replace' : 'from the website: /admin → Upload keys'"
						/>
					</label>
					<button type="submit">Save settings</button>
				</form>
				<p v-if="!status.connection.ok" class="muted">{{ status.connection.error }}</p>
			</fieldset>
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

	& .size,
	& .name {
		display: flex;
		align-items: flex-end;
		gap: var(--gap);
	}

	& .name label:last-child {
		flex: 1;
	}

	& .number {
		padding-bottom: 0.4rem;
		font-weight: bold;
	}

	& .sync {
		align-items: flex-start;

		& p {
			margin: 0;
		}

		& form {
			display: flex;
			flex-wrap: wrap;
			align-items: flex-end;
			gap: var(--gap);

			& label {
				flex: 1 1 16rem;
			}
		}
	}

	& .saved {
		display: grid;
		grid-template-columns: repeat(auto-fill, minmax(8rem, 1fr));
		gap: var(--gap);

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
