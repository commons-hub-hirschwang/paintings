<script setup lang="ts">
// Local capture tool (pnpm capture): project → capture → corners → title/size → save offline → sync.
import { computed, ref, watch } from 'vue'
import CornerEditor from './CornerEditor.vue'
import { bridge, type BridgeStatus, type LocalPainting } from './bridge'
import { estimateSizeCm, type Quad } from '../shared/geometry'

const confirmedKey = () => `capture:calibration-confirmed:${status.value?.project}`
const newProject = ref('')

const status = ref<BridgeStatus | null>(null)
const askReuse = ref(false)
const photo = ref<string | null>(null)
const quad = ref<Quad | null>(null)
let photoSize = { width: 0, height: 0 }
let lastQuad: { quad: Quad; width: number; height: number } | null = null
const title = ref('')
const group = ref('')
const NEW_GROUP = '\u0000new'
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
	run('Rectifying…', async () => {
		await bridge.process({
			file: photo.value!,
			quad: quad.value!,
			title: title.value.trim(),
			group: group.value,
			...(measured.value ? { widthCm: Number(widthCm.value), heightCm: Number(heightCm.value) } : {}),
		})
		lastQuad = { quad: quad.value!, ...photoSize }
		if (measured.value) sessionStorage.setItem(confirmedKey(), 'yes')
		status.value = await bridge.status()
		paintings.value = await bridge.paintings()
		photo.value = null
		quad.value = null
		title.value = ''
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
				{{ calibration ? `calibrated, ${calibration.pxPerCm.toFixed(2)} px/cm` : 'not calibrated' }}
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
				<CornerEditor v-model="quad" :src="bridge.rawUrl(photo)" @loaded="onPhotoLoaded" />

				<form @submit.prevent="canSave && save()">
					<fieldset>
					<legend>Painting</legend>
					<p class="muted">Press anywhere and move: the nearest corner follows (Shift = slow). Keys 1–4 select a corner, arrows nudge it.</p>
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
							{{ cm(painting.widthCm) }} × {{ cm(painting.heightCm) }} cm · {{ painting.isSynced ? 'synced' : 'not synced' }}
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
