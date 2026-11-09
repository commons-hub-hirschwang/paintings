<script setup lang="ts">
// Local capture tool (pnpm capture): project → capture → corners → title/size → save offline → sync.
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import ColorCalibration from './ColorCalibration.vue'
import CornerEditor from './CornerEditor.vue'
import { bridge, type Bow, type BridgeStatus, type Detection, type LocalPainting, type Photo, type SyncProgress } from './bridge'
import { cornerRadius, measureAmbient, wallColors } from '../src/ambient'
import { estimateSizeCm, MAX_BOW, reconstruct, turnCorners, type Camera, type Quad } from '../shared/geometry'

const confirmedKey = () => `capture:calibration-confirmed:${status.value?.project}`
const colorConfirmedKey = () => `capture:color-confirmed:${status.value?.project}`
const newProject = ref('')

const status = ref<BridgeStatus | null>(null)
const askReuse = ref(false)
const askColorReuse = ref(false)
const calibratingColor = ref(false)
const warnings = ref<string[]>([])
const photo = ref<string | null>(null)
// the saved painting brought up in the editor (null: a new photo). What a capture series keeps is restored afterwards.
const editing = ref<LocalPainting | null>(null)
let beforeEditing: { turns: number; stack: string; material: string } | null = null
// corners in the painting's orientation: TL is the painting's top left, also when photographed sideways
const quad = ref<Quad | null>(null)
// view turned clockwise in quarter turns; kept for the next photos (a series photographed the same way)
const turns = ref(0)
// automatic corners (in the painting's orientation)
const detection = ref<Detection | null>(null)
const keptDetection = computed(() => !!detection.value && quad.value === detection.value.quad)
// the corners shown last (automatic, opened or snapped): corners moved away from them were moved off a wrong edge,
// a snap keeps them near where they were put
let shown: Quad | null = null
const snapWarning = ref('')
// how the sides curve between the current corners: measured again after they changed, applied on save
const bows = ref<Bow[] | null>(null)
const maxBow = computed(() => Math.max(0, ...(bows.value?.map((side) => Math.abs(side.bowPx)) ?? [])))
const sideNames = ['top', 'right', 'bottom', 'left']
const sideLength = (k: number) => {
	const [a, b] = [quad.value![k]!, quad.value![(k + 1) % 4]!]
	return Math.hypot(b.x - a.x, b.y - a.y)
}
const namesOf = (test: (side: Bow, k: number) => boolean) =>
	sideNames.filter((_, k) => bows.value && quad.value && test(bows.value[k]!, k)).join(', ')
const unclearSides = computed(() => namesOf((side) => !side.clear))
const sidesAtLimit = computed(() => namesOf((side, k) => Math.abs(side.bowPx) >= MAX_BOW * sideLength(k) - 1))
let bowTimer: ReturnType<typeof setTimeout>
let bowRequest = 0
watch([quad, photo], ([corners, file]) => {
	bows.value = null
	clearTimeout(bowTimer)
	const request = ++bowRequest
	if (!corners || !file) return
	bowTimer = setTimeout(async () => {
		const result = await bridge.bows(file, corners).catch(() => null)
		if (request === bowRequest) bows.value = result
	}, 300)
})
const camera = ref<Camera | null>(null)
let photoSize = { width: 0, height: 0 }
let lastQuad: { quad: Quad; turns: number; width: number; height: number } | null = null
const title = ref('')
const stack = ref('')
const NEW_STACK = '\u0000new'
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

async function refreshPaintings() {
	paintings.value = await bridge.paintings()
	if (status.value) status.value.unsynced = paintings.value.filter((p) => p.isWaiting).length
}
// paintings are finished in the background: followed until they are
const rendering = computed(() => paintings.value.some((p) => p.rendering && !p.rendering.error))
let renderPoll: ReturnType<typeof setInterval>
watch(rendering, (active) => {
	clearInterval(renderPoll)
	if (active) renderPoll = setInterval(() => refreshPaintings().catch(() => {}), 1000)
})
onBeforeUnmount(() => clearInterval(renderPoll))

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
		// keep the chosen stack; default: stack of the last capture
		if (!status.value.stacks?.includes(stack.value)) stack.value = paintings.value[0]?.stack ?? status.value.stacks?.[0] ?? ''
		if (!material.value) material.value = paintings.value[0]?.material ?? ''
		askReuse.value = !!status.value.calibration && sessionStorage.getItem(confirmedKey()) !== 'yes'
		askColorReuse.value = !!status.value.color && sessionStorage.getItem(colorConfirmedKey()) !== 'yes'
	})
refreshStatus()

async function answerReuse(reuse: boolean) {
	if (!reuse) await run('Resetting calibration…', () => bridge.forgetCalibration().then(refreshStatus))
	sessionStorage.setItem(confirmedKey(), 'yes')
	askReuse.value = false
}

function answerColorReuse(reuse: boolean) {
	sessionStorage.setItem(colorConfirmedKey(), 'yes')
	askColorReuse.value = false
	calibratingColor.value = !reuse
}

async function colorCalibrated() {
	calibratingColor.value = false
	sessionStorage.setItem(colorConfirmedKey(), 'yes')
	status.value = await bridge.status()
}

const openProject = (name: string, create = false) =>
	run('Opening project…', async () => {
		await bridge.openProject(name, create)
		photo.value = null
		editing.value = null
		beforeEditing = null
		lastQuad = null
		newProject.value = ''
		await refreshStatus()
	})

// "New stack…" in the select asks for a name: just that name, the gallery has it from the first upload
function chooseStack(select: HTMLSelectElement) {
	if (select.value !== NEW_STACK) return (stack.value = select.value)
	const name = prompt('Name of the new stack')?.trim()
	select.value = stack.value
	if (name) stack.value = name
}
const stackChoices = computed(() => [...new Set([...(status.value?.stacks ?? []), stack.value])].filter(Boolean))

const calibration = computed(() => status.value?.calibration ?? null)
const color = computed(() => status.value?.color ?? null)
const age = (time: number) => {
	const minutes = Math.round((Date.now() - time) / 60000)
	return minutes < 60 ? `${minutes} min ago` : minutes < 48 * 60 ? `${Math.round(minutes / 60)} h ago` : `${Math.round(minutes / 1440)} days ago`
}
const measured = computed(() => Number(widthCm.value) > 0 && Number(heightCm.value) > 0)
const estimate = computed(() =>
	quad.value && calibration.value && camera.value ? estimateSizeCm(quad.value, calibration.value, camera.value) : null,
)
// 3D shape from the corners: tilt of the painting and how far the corner angle is from 90°
const shape = computed(() => (quad.value && camera.value ? reconstruct(quad.value, camera.value) : null))
const canSave = computed(() => !!photo.value && !!quad.value && !busy.value && (measured.value || !!calibration.value))

const canCapture = computed(() => !busy.value && !!status.value?.cameras.length && !!color.value)
const capture = () => {
	window.scrollTo({ top: 0 })
	return run('Capturing…', async () => setPhoto(await bridge.capture()))
}

// size of the captured paintings' icons (rem), remembered in this browser; small ones without captions
const iconSize = ref(Number(localStorage.getItem('capture:icon-size')) || 8)
watch(iconSize, (size) => localStorage.setItem('capture:icon-size', String(size)))

// after saving a painting: on to the next one, or a pause. Enter or Space goes on, Esc stops
const savedAs = ref('')
const nextButton = ref<HTMLButtonElement>()
watch(nextButton, (button) => button?.focus())
const stop = () => (savedAs.value = '')
function captureNext() {
	stop()
	capture()
}

function upload(event: Event) {
	const file = (event.target as HTMLInputElement).files?.[0]
	if (file) run('Uploading…', async () => setPhoto(await bridge.upload(file)))
}

// the bridge detects in the photo's orientation; turned into the painting's
const turnDetection = (d: Detection, by: number): Detection => ({
	...d,
	quad: turnCorners(d.quad, by) as Quad,
})

function setPhoto(result: Photo) {
	detection.value = result.detection && turnDetection(result.detection, turns.value)
	quad.value = detection.value?.quad ?? null
	shown = quad.value
	snapWarning.value = ''
	camera.value = result.camera
	photo.value = result.file
	warnings.value = result.warnings
}

// roughly placed corners → snapped to the painting's edges
const snap = () =>
	run('Snapping to edges…', async () => {
		const result = await bridge.detect(photo.value!, quad.value!, shown)
		detection.value = turnDetection(result, turns.value)
		quad.value = shown = detection.value.quad
		snapWarning.value = result.unsnapped
			? `No edge near the moved corners (${result.unsnapped} side${result.unsnapped > 1 ? 's' : ''}): left where placed.`
			: ''
	})

// painting photographed sideways: turn the view; the corners turn along (same points, new top)
function turn(direction: 1 | -1) {
	turns.value = (turns.value + direction + 4) % 4
	if (editing.value) [widthCm.value, heightCm.value] = [heightCm.value, widthCm.value]
	if (keptDetection.value) {
		detection.value = turnDetection(detection.value!, direction)
		quad.value = detection.value.quad
	} else if (quad.value) quad.value = turnCorners(quad.value, direction) as Quad
	if (shown) shown = turnCorners(shown, direction) as Quad
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

// bring up a saved painting: same editor, with its corners, the view turned as it was saved
const openPainting = (painting: LocalPainting) =>
	run('Opening…', async () => {
		const { file, camera: photoCamera, quad: corners } = await bridge.paintingSource(painting.id)
		beforeEditing ??= { turns: turns.value, stack: stack.value, material: material.value }
		editing.value = painting
		detection.value = null
		warnings.value = []
		camera.value = photoCamera
		photo.value = file
		quad.value = shown = corners
		snapWarning.value = ''
		// the corner at the photo's top left tells how far the view was turned
		const sums = corners.map((p) => p.x + p.y)
		turns.value = sums.indexOf(Math.min(...sums))
		title.value = painting.title
		stack.value = painting.stack
		material.value = painting.material ?? ''
		typingMaterial.value = false
		widthCm.value = painting.widthCm
		heightCm.value = painting.heightCm
	})

function closeEditor() {
	photo.value = null
	if (!editing.value) return
	editing.value = null
	quad.value = null
	title.value = ''
	typingMaterial.value = false
	widthCm.value = heightCm.value = ''
	turns.value = beforeEditing!.turns
	stack.value = beforeEditing!.stack
	material.value = beforeEditing!.material
	beforeEditing = null
}

const saveChanges = () =>
	run('Saving changes…', async () => {
		const { id, isSynced, title: savedTitle } = editing.value!
		const changed = await bridge.changePainting(id, {
			quad: quad.value!,
			stack: stack.value,
			material: material.value.trim(),
			title: isSynced ? savedTitle : title.value.trim(),
			widthCm: Number(widthCm.value),
			heightCm: Number(heightCm.value),
		})
		status.value = await bridge.status()
		paintings.value = await bridge.paintings()
		closeEditor()
		notice.value = `Saved. ${changed.isWaiting ? 'Press Sync to send it to the website.' : ''}`
	})

// answers right away: the images are made in the background, the next photo can be taken
const save = () =>
	run('Saving…', async () => {
		const { painting, calibration: saved } = await bridge.process({
			file: photo.value!,
			quad: quad.value!,
			title: title.value.trim(),
			stack: stack.value,
			material: material.value.trim(),
			...(measured.value ? { widthCm: Number(widthCm.value), heightCm: Number(heightCm.value) } : {}),
		})
		lastQuad = { quad: quad.value!, turns: turns.value, ...photoSize }
		if (measured.value) sessionStorage.setItem(confirmedKey(), 'yes')
		status.value!.calibration = saved
		await refreshPaintings()
		photo.value = null
		quad.value = null
		title.value = ''
		typingMaterial.value = false
		widthCm.value = heightCm.value = ''
		window.scrollTo({ top: 0 })
		savedAs.value = painting.stack
	})

const SYNC_POLL = 300
const syncing = ref<SyncProgress | null>(null)
const sync = () =>
	run(`Syncing to ${status.value?.galleryUrl}…`, async () => {
		const poll = setInterval(() => bridge.syncProgress().then((progress) => (syncing.value = progress), () => {}), SYNC_POLL)
		const { synced, failed } = await bridge.sync().finally(() => {
			clearInterval(poll)
			syncing.value = null
		})
		notice.value = `${synced} synced to ${status.value?.galleryUrl} (as drafts, not public yet)`
		status.value = await bridge.status()
		paintings.value = await bridge.paintings()
		if (failed.length) error.value = `Stopped at the first failure, the rest stays waiting: ${failed[0]!.error}`
	})
const cm = (value: number) => value.toFixed(1)
</script>

<template>
	<main id="capture">
		<header>
			<div>
			<h1>Capture</h1>
			<select v-if="status?.projects.length" :value="status.project ?? ''" @change="openProject(($event.target as HTMLSelectElement).value)">
				<option v-if="!status.project" value="" disabled>Open project…</option>
				<option v-for="project in status.projects" :key="project">{{ project }}</option>
			</select>
			<form class="actions" @submit.prevent="openProject(newProject, true)">
				<input v-model="newProject" placeholder="New project, e.s. attic" required />
				<button type="submit">Create</button>
			</form>
			</div>
			<div>
			<button @click="refreshStatus">Refresh</button>
			<span v-if="status?.project" class="muted">
				Camera: {{ status.cameras[0] ?? 'none detected' }} ·
				{{
					calibration
						? calibration.centerDepthCm
							? `calibrated at ${(calibration.centerDepthCm / 100).toFixed(2)} m`
							: `calibrated, ${calibration.pxPerCm.toFixed(2)} px/cm`
						: 'distance not calibrated'
				}}
				·
				{{ color ? `colour: ${color.shutter} s, f/${color.fNumber}, ISO ${color.iso}, ${color.kelvin} K (${age(color.createdAt)})` : 'colour not calibrated' }}
			</span>
			</div>
			<div v-if="status?.project">
				<button :disabled="!!busy" @click="calibratingColor = true">Calibrate colour</button>
				<button v-if="calibration" :disabled="!!busy" @click="askReuse = true">Calibrate distance</button>
			</div>
		</header>


		<p v-if="error" class="error">{{ error }}</p>
		<p v-if="busy" class="muted">{{ busy }}</p>
		<p v-if="notice">{{ notice }}</p>

		<section v-if="askReuse" class="dialog">
			<p>Same distance from camera to painting as before? (reuse calibration)</p>
			<button @click="answerReuse(true)">Yes, reuse</button>
			<button @click="answerReuse(false)">No, measure again</button>
		</section>

		<section v-else-if="askColorReuse" class="dialog">
			<p>Same light as before? (reuse colour calibration)</p>
			<img v-if="color" class="patch" :src="bridge.colorImageUrl('patch.jpg', color.createdAt)" alt="the white area of the last calibration" />
			<button @click="answerColorReuse(true)">Yes, reuse</button>
			<button @click="answerColorReuse(false)">No, calibrate again</button>
		</section>

		<ColorCalibration
			v-else-if="status?.project && calibratingColor"
			:run="run"
			:busy="!!busy"
			:previous="color"
			@done="colorCalibrated"
			@cancel="calibratingColor = false"
		/>

		<p v-else-if="status && !status.project" class="muted">Create or open a project to start.</p>

		<template v-else-if="status">
			<p v-if="!color" class="warning">Calibrate colour first: mark a white area of a painting, in this session's light.</p>
			<template v-else>
				<p v-for="warning in color.warnings" :key="warning" class="warning">{{ warning }}</p>
			</template>

			<section v-if="!photo" class="actions">
				<button :disabled="!canCapture" @click="capture">Capture with camera</button>
				<label class="button">
					Upload photo
					<input type="file" accept="image/jpeg" hidden @change="upload" />
				</label>
			</section>

			<section v-else class="editor">
				<CornerEditor v-model="quad" :src="bridge.photoUrl(photo, editing?.id)" :turns="turns" :bows="bows" @turn="turn" @loaded="onPhotoLoaded" />

				<form @submit.prevent="canSave && (editing ? saveChanges() : save())">
					<fieldset>
					<legend>{{ editing ? `Edit ${editing.title || 'Untitled'}` : 'Painting' }}</legend>
					<div class="notes">
						<p v-for="warning in warnings" :key="warning" class="warning">{{ warning }}</p>
						<p v-if="snapWarning" class="warning">{{ snapWarning }}</p>
						<p v-if="keptDetection && !detection!.trusted" class="warning">Detection unsure — check the corners.</p>
						<p v-else-if="!detection && !editing" class="warning">No painting edges found — set the corners.</p>
						<p v-if="shape && shape.angleErrorDeg > 1.5" class="warning">Corners {{ shape.angleErrorDeg.toFixed(1) }}° off square — check the corners.</p>
						<p v-if="sidesAtLimit" class="warning">Curve at the {{ MAX_BOW * 100 }} % limit ({{ sidesAtLimit }}): probably not the painting's edge, check the corners.</p>
						<p v-if="editing?.isSynced" class="muted">On the website: stack, name and material are changed there. Corners and size arrive with the next sync.</p>
						<p>
							<template v-if="keptDetection && detection!.trusted">Corners detected automatically. </template>
							<template v-if="shape">Tilted {{ shape.tiltDeg.toFixed(1) }}°, corners {{ shape.angleErrorDeg.toFixed(1) }}° off square. </template>
							<template v-else-if="camera && !camera.focalPx">No focal length in this photo: size ignores tilt. </template>
							<template v-if="maxBow > 0">Edges curve up to {{ maxBow.toFixed(0) }} px (cyan; dashed: the {{ MAX_BOW * 100 }} % limit): warped straight on save. </template>
							<template v-if="unclearSides">No clear edge ({{ unclearSides }}): kept straight.</template>
						</p>
					</div>
					<div class="hint">
						<p class="muted">Press anywhere and move: the nearest corner follows (Shift = slow). Keys 1–4 select a corner, arrows nudge it.</p>
						<button type="button" :disabled="!!busy || !quad" @click="snap">Snap to edges (S)</button>
					</div>
					<div class="fields">
						<label>
							Stack
							<select :value="stack" :disabled="editing?.isSynced" @change="chooseStack($event.target as HTMLSelectElement)">
								<option v-for="s in stackChoices" :key="s">{{ s }}</option>
								<option :value="NEW_STACK">New stack…</option>
							</select>
						</label>
						<label class="grow">
							Name
							<input v-model="title" placeholder="Untitled" :disabled="editing?.isSynced" autofocus />
						</label>
						<label class="grow">
							Material
							<select :value="typingMaterial ? NEW_MATERIAL : material" :disabled="editing?.isSynced" @change="chooseMaterial(($event.target as HTMLSelectElement).value)">
								<option v-if="!materials.length && !typingMaterial" value="" disabled>–</option>
								<option v-for="m in materials" :key="m" :value="m">{{ m }}</option>
								<option :value="NEW_MATERIAL">New material…</option>
							</select>
						</label>
						<label v-if="typingMaterial" class="grow">
							New material
							<input v-model="material" placeholder="e.s. Öl auf Leinwand" autofocus />
						</label>
					</div>
					<div v-if="!editing" class="notes">
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
					</div>
					<div class="fields">
						<label>
							Width (cm)
							<input v-model="widthCm" type="number" min="1" step="0.1" :required="!calibration || !!editing" />
						</label>
						<label>
							Height (cm)
							<input v-model="heightCm" type="number" min="1" step="0.1" :required="!calibration || !!editing" />
						</label>
						<div class="actions">
							<button type="submit" :disabled="!canSave">{{ editing ? 'Save changes' : 'Save painting' }}</button>
							<button type="button" :disabled="!!busy" @click="closeEditor">{{ editing ? 'Cancel' : 'Discard photo' }}</button>
						</div>
					</div>
					</fieldset>
				</form>
			</section>

			<section v-if="savedAs" class="next" @keydown.esc="stop">
				<p>Saved to stack {{ savedAs }}</p>
				<div>
					<button type="button" @click="stop">Stop</button>
					<button ref="nextButton" type="button" :disabled="!canCapture" @click="captureNext">Capture next</button>
				</div>
			</section>

			<fieldset v-if="paintings.length" class="saved" :class="{ compact: iconSize < 7 }" :style="{ '--icon-size': `${iconSize}rem` }">
				<legend>Captured ({{ paintings.length }})</legend>
				<label class="icon-size">Icon size <input v-model.number="iconSize" type="range" min="3" max="24" step="1" /></label>
				<button
					v-for="painting in paintings"
					:key="painting.id"
					type="button"
					:class="{ current: editing?.id === painting.id }"
					:style="wallColors(bridge.thumbUrl(painting))"
					:disabled="!!busy || !painting.original || (!!photo && !editing)"
					:title="painting.rendering ? 'Being finished' : painting.original ? 'Change this painting' : 'Saved without its photo data: cannot be changed'"
					@click="openPainting(painting)"
				>
					<span v-if="painting.rendering" class="pending muted">{{ painting.rendering.error ? 'Failed' : 'Rendering…' }}</span>
					<!-- measured per thumb version: a changed painting gets its new color -->
					<div v-else class="wall">
						<img
							:src="bridge.thumbUrl(painting)"
							:alt="painting.title"
							:style="{ borderRadius: cornerRadius(painting.widthCm, painting.heightCm) }"
							@load="measureAmbient(bridge.thumbUrl(painting), $event.target as HTMLImageElement)"
						/>
					</div>
					<span class="caption">
						<span><strong>{{ painting.stack }}</strong> {{ painting.title || 'Untitled' }}</span>
						<span class="muted">
							{{ cm(painting.widthCm) }} × {{ cm(painting.heightCm) }} cm ·
							<template v-if="painting.material">{{ painting.material }} · </template>
							{{ painting.isWaiting ? 'waiting' : 'uploaded' }}
						</span>
						<span v-if="painting.rendering?.error" class="error">{{ painting.rendering.error }} (tried again when the capture tool restarts)</span>
					</span>
				</button>
			</fieldset>

			<!-- sync to the website: below the captured paintings -->
			<fieldset class="sync">
				<legend>Sync</legend>
				<p>
					{{ status.unsynced }} waiting for {{ status.galleryUrl }}
					<span :class="status.connection.ok ? 'muted' : 'error'">
						({{ status.connection.ok ? `key "${status.connection.key}"` : status.hasUploadKey ? 'not reachable / key invalid' : 'no upload key' }})
					</span>
				</p>
				<button :disabled="!!busy" @click="sync">Sync {{ status.unsynced || '' }}</button>
				<template v-if="syncing">
					<label>
						{{ syncing.title }}: {{ syncing.step }}
						<progress :value="syncing.stepsDone" :max="syncing.steps"></progress>
					</label>
					<label>
						{{ syncing.done }} of {{ syncing.total }} paintings
						<progress :value="syncing.done + syncing.stepsDone / syncing.steps" :max="syncing.total"></progress>
					</label>
				</template>
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

	& p {
		margin: 0;
	}

	& .warning {
		padding: 0.25rem 0.75rem;
	}

	& header {
		display: flex;
		flex-direction: column;
		gap: var(--gap);

		& > div {
			display: flex;
			flex-wrap: wrap;
			align-items: baseline;
			gap: var(--gap);
		}
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

	& .next {
		position: fixed;
		inset: 0;
		z-index: 1;
		display: flex;
		flex-direction: column;
		justify-content: center;
		gap: var(--gap);
		padding: var(--gap);
		background: rgba(0, 0, 0, 0.8);
		color: #fff;
		font-size: 2rem;
		text-align: center;

		& div {
			flex: 0 1 60vh;
			display: flex;
			gap: var(--gap);
		}

		& button {
			flex: 1;
			font-size: 3rem;
		}
	}

	& .patch {
		display: block;
		max-width: 12rem;
	}

	& .notes {
		display: flex;
		flex-direction: column;
		gap: 0.25rem;

		&:empty,
		& p:empty {
			display: none;
		}
	}

	& .hint {
		display: flex;
		align-items: center;
		gap: var(--gap);

		& p {
			flex: 1;
		}
	}

	& .fields {
		display: flex;
		flex-wrap: wrap;
		align-items: flex-end;
		gap: var(--gap);

		& label:not(.grow) input {
			width: 7rem;
		}

		& input,
		& select {
			height: 2.4rem;
		}

		& .grow {
			flex: 1 1 10rem;
		}

		& .actions {
			margin-left: auto;
		}
	}

	& .sync {
		align-items: flex-start;

		& progress {
			display: block;
			width: 20rem;
			max-width: 100%;
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

	/* like the gallery: tiles side by side without gaps, each a piece of wall in its painting's color */
	& .saved {
		display: grid;
		grid-template-columns: repeat(auto-fill, minmax(var(--icon-size), 1fr));
		/* the fieldset's own gap: none, the walls meet */
		gap: 0;

		& .icon-size {
			grid-column: 1 / -1;
			display: flex;
			align-items: center;
			gap: var(--gap);
			margin-bottom: var(--gap);
		}

		&.compact .caption {
			display: none;
		}

		& > button {
			display: flex;
			flex-direction: column;
			gap: var(--gap);
			padding: calc(0.12 * var(--icon-size));
			border: none;
			border-radius: 0;
			background: var(--bg);
			color: var(--fg);
			text-align: left;
			transition: background 0.4s;

			&.current {
				outline: 2px solid var(--fg);
				outline-offset: -2px;
			}
		}

		& .wall,
		& .pending {
			width: 100%;
			aspect-ratio: 1;
		}

		& .wall img {
			box-shadow: 0 0.15rem 0.5rem #000;
		}

		& .pending {
			display: grid;
			place-items: center;
		}

		& .caption {
			display: flex;
			flex-direction: column;
		}
	}
}
</style>
