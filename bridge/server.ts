// Local capture tool (pnpm capture): serves the capture UI (capture/, via Vite) and its API under /bridge
// on http://localhost:5174. Runs on the laptop the camera is plugged into; works offline, syncs later.
import { execFile } from 'node:child_process'
import { existsSync } from 'node:fs'
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { basename, join } from 'node:path'
import { promisify } from 'node:util'
import { createServer } from 'node:http'
import { getRequestListener } from '@hono/node-server'
import vue from '@vitejs/plugin-vue'
import { createServer as createViteServer } from 'vite'
import { Hono } from 'hono'
import { calibrate, estimateSizeCm, rectifiedSize, type Calibration, type Quad } from '../shared/geometry'
import sharp from 'sharp'
import { archive, webVariants } from '../shared/image-variants'
import { checkConnection, getSettings, saveSettings } from './api'
import { listPaintings, nextNumber, paintingFile, savePainting } from './store'
import { isSynced, syncAll } from './sync'
import { addGroup, currentProject, listGroups, listProjects, openProject, projectPath } from './project'
import { correctLens, readOriented, warpToRectangle } from './warp'
import { applyGains, calibrateColor, colorFile, correctionFor, measure, readColorCalibration, shotFile, takeReference, type Box } from './color'
import { ensureLocked, exclusive, exposureMismatch, forgetCameraState, shoot } from './tether'
import { cameraOf, exposureOf, lensOf } from './camera'
import { detectCorners, trusted } from './detect'

const run = promisify(execFile)
// raw: the camera's photos (untouched); corrected: lens-corrected copies, in which corners are picked
const dirs = { get raw() { return projectPath('raw') }, get corrected() { return projectPath('corrected') } }
const calibrationFile = () => projectPath('calibration.json')
// created before every write, so deleting captures/ while the bridge runs is harmless
const ensureDirs = () => Promise.all([mkdir(dirs.raw, { recursive: true }), mkdir(dirs.corrected, { recursive: true })])

// the photo the corner editor shows (lens-corrected when the lens has a profile), created on demand
async function correctedPhoto(file: string) {
	const raw = join(dirs.raw, basename(file))
	if (!existsSync(raw)) return null
	const camera = await cameraOf(raw)
	const lens = lensOf(camera)
	if (!lens) return { path: raw, camera, raw }
	const path = join(dirs.corrected, `${basename(file)}.jpg`)
	if (!existsSync(path)) {
		await ensureDirs()
		await writeFile(path, await correctLens(raw, lens))
	}
	return { path, camera, raw }
}

// corners of the last saved painting: the next one usually stands at the same spot (detection hint)
let lastQuad: { quad: Quad; width: number; height: number } | null = null

async function photoResult(file: string) {
	const photo = (await correctedPhoto(file))!
	const hint = lastQuad && lastQuad.width === photo.camera.width && lastQuad.height === photo.camera.height ? lastQuad.quad : null
	const detection = await detectCorners(photo.path, hint).catch((error) => (console.error(error), null))
	return {
		file,
		camera: photo.camera,
		detection: detection && { ...detection, trusted: trusted(detection, photo.camera) },
	}
}

const readCalibration = async (): Promise<Calibration | null> =>
	existsSync(calibrationFile()) ? JSON.parse(await readFile(calibrationFile(), 'utf8')) : null

const app = new Hono()
app.onError((error, c) => {
	console.error(error)
	return c.json({ error: error.message }, 500)
})

app.get('/status', async (c) => {
	const { stdout } = await run('gphoto2', ['--auto-detect']).catch(() => ({ stdout: '' }))
	// output: header, dashes, then "Model   Port" lines
	const cameras = stdout.split('\n').slice(2).map((line) => line.trim()).filter(Boolean)
	const project = currentProject()
	if (!project) return c.json({ cameras, project, projects: listProjects() })
	const unsynced = (await listPaintings()).filter((p) => !isSynced(p)).length
	const { galleryUrl, uploadKey } = getSettings()
	return c.json({
		cameras,
		project,
		projects: listProjects(),
		groups: listGroups(),
		calibration: await readCalibration(),
		color: await readColorCalibration(),
		galleryUrl,
		hasUploadKey: !!uploadKey,
		connection: await checkConnection(),
		unsynced,
	})
})

// what the photographer should know about a shot: settings that didn't hold, blown-out highlights in the painting
async function shotWarnings(file: string, shutter: string, detection: Awaited<ReturnType<typeof photoResult>>['detection']) {
	const raw = join(dirs.raw, basename(file))
	const mismatch = exposureMismatch(await exposureOf(raw), shutter)
	if (mismatch.length) forgetCameraState() // set everything again before the next capture
	const warnings = mismatch.length ? [`Not the calibrated settings: ${mismatch.join(', ')} — not colour corrected.`] : []
	if (detection) {
		const xs = detection.quad.map((p) => p.x)
		const ys = detection.quad.map((p) => p.y)
		const box = { left: Math.min(...xs), top: Math.min(...ys), width: Math.max(...xs) - Math.min(...xs), height: Math.max(...ys) - Math.min(...ys) }
		const { clippedShare } = measure(await readOriented(raw), box)
		if (clippedShare > 0.001) warnings.push(`${(clippedShare * 100).toFixed(1)} % of the painting is blown out (brighter than the calibration white).`)
	}
	return warnings
}

// remote-trigger the tethered camera with the calibrated settings, keep RAW + JPEG
app.post('/capture', (c) =>
	exclusive(async () => {
		const color = await readColorCalibration()
		if (!color) return c.json({ error: 'calibrate colour first' }, 400)
		await ensureDirs()
		await ensureLocked({ shutter: color.shutter, kelvin: color.kelvin })
		const result = await photoResult(basename(await shoot(dirs.raw)))
		return c.json({ ...result, warnings: await shotWarnings(result.file, color.shutter, result.detection) })
	}),
)

// colour calibration: reference photo → mark the white area → calibrate (see color.ts)
app.post('/color/reference', async (c) => c.json(await exclusive(takeReference)))
app.post('/color/calibrate', async (c) => {
	const { file, box } = await c.req.json<{ file: string; box: Box }>()
	return c.json(await exclusive(() => calibrateColor(file, box)))
})
app.get('/color/shot/:file', async (c) => {
	const file = shotFile(c.req.param('file'))
	if (!existsSync(file)) return c.notFound()
	return c.body(new Uint8Array(await readFile(file)), 200, { 'content-type': 'image/jpeg' })
})
app.get('/color/:name{reference\\.jpg|patch\\.jpg}', async (c) => {
	const file = colorFile(c.req.param('name') as 'reference.jpg')
	if (!existsSync(file)) return c.notFound()
	return c.body(new Uint8Array(await readFile(file)), 200, { 'content-type': 'image/jpeg', 'cache-control': 'no-store' })
})

// fallback: photo taken with a phone, uploaded from the browser
app.post('/upload', async (c) => {
	await ensureDirs()
	const file = `${Date.now()}.jpg`
	await writeFile(join(dirs.raw, file), new Uint8Array(await c.req.arrayBuffer()))
	return c.json({ ...(await photoResult(file)), warnings: [] })
})

app.get('/photo/:file', async (c) => {
	const photo = await correctedPhoto(c.req.param('file'))
	if (!photo) return c.notFound()
	// shown as it will be saved
	const color = await correctionFor(photo.raw)
	if (!color) return c.body(new Uint8Array(await readFile(photo.path)), 200, { 'content-type': 'image/jpeg' })
	const { data, width, height } = await readOriented(photo.path)
	const jpeg = await sharp(applyGains(data, color.gains), { raw: { width, height, channels: 3 } }).jpeg({ quality: 90 }).toBuffer()
	return c.body(new Uint8Array(jpeg), 200, { 'content-type': 'image/jpeg' })
})

// "snap": refine roughly placed corners to the painting's edges
app.post('/detect', async (c) => {
	const { file, quad } = await c.req.json<{ file: string; quad: Quad }>()
	const photo = await correctedPhoto(file)
	if (!photo) return c.notFound()
	const detection = await detectCorners(photo.path, quad, true)
	if (!detection) return c.json({ error: 'no clear edges near these corners' }, 422)
	return c.json({ ...detection, trusted: trusted(detection, photo.camera) })
})

// "same distance from camera to painting as before?" — no → forget calibration
app.delete('/calibration', async (c) => {
	await rm(calibrationFile(), { force: true })
	return c.json({ ok: true })
})

// the photo around the selected corners (+ margin) instead of the whole photo, with the corners relative to it
const ORIGINAL_MARGIN = 50
async function cropOriginal(photo: string, quad: Quad) {
	const upright = await sharp(photo).rotate().toBuffer({ resolveWithObject: true }) // same orientation as the editor
	const xs = quad.map((p) => p.x)
	const ys = quad.map((p) => p.y)
	const left = Math.max(0, Math.floor(Math.min(...xs) - ORIGINAL_MARGIN))
	const top = Math.max(0, Math.floor(Math.min(...ys) - ORIGINAL_MARGIN))
	const crop = {
		left,
		top,
		width: Math.min(upright.info.width, Math.ceil(Math.max(...xs) + ORIGINAL_MARGIN)) - left,
		height: Math.min(upright.info.height, Math.ceil(Math.max(...ys) + ORIGINAL_MARGIN)) - top,
	}
	const jpeg = await sharp(upright.data).extract(crop).jpeg({ quality: archive.quality }).toBuffer()
	return { jpeg, crop, quad: quad.map((p) => ({ x: p.x - left, y: p.y - top })) as Quad }
}

// corners selected → rectify and store locally (works offline; uploaded by /sync)
app.post('/process', async (c) => {
	await ensureDirs()
	// bows: per side (top, right, bottom, left), from the detection, when its corners were kept
	const body = await c.req.json<{
		file: string
		quad: Quad
		bows?: number[]
		title: string
		group: string
		material?: string
		widthCm?: number
		heightCm?: number
	}>()
	if (!listGroups().includes(body.group)) return c.json({ error: `unknown group "${body.group}"` }, 400)
	const photo = await correctedPhoto(body.file)
	if (!photo) return c.json({ error: `no photo "${body.file}"` }, 404)
	const { camera } = photo
	let calibration = await readCalibration()
	let size: { widthCm: number; heightCm: number }
	if (body.widthCm && body.heightCm) {
		// measured painting: (re)calibrates
		size = { widthCm: body.widthCm, heightCm: body.heightCm }
		calibration = { ...calibrate(body.quad, size.widthCm, size.heightCm, camera), lensCorrected: !!camera.lens }
		await writeFile(calibrationFile(), JSON.stringify(calibration, null, '\t'))
	} else if (calibration) {
		size = estimateSizeCm(body.quad, calibration, camera)
	} else {
		return c.json({ error: 'no calibration — measure this painting' }, 400)
	}

	const { width, height } = rectifiedSize(body.quad, size.widthCm, size.heightCm)
	const color = await correctionFor(photo.raw)
	const archive = await warpToRectangle(photo.raw, body.quad, width, height, lensOf(camera), body.bows, color ? (data) => applyGains(data, color.gains) : undefined)
	const original = await cropOriginal(photo.path, body.quad)
	lastQuad = { quad: body.quad, width: camera.width, height: camera.height }

	const { maxSize, quality } = webVariants.thumb
	const thumb = await sharp(archive).resize({ width: maxSize, height: maxSize, fit: 'inside' }).jpeg({ quality }).toBuffer()
	const round = (cm: number) => Math.round(cm * 10) / 10
	const painting = {
		id: crypto.randomUUID(),
		title: body.title,
		widthCm: round(size.widthCm),
		heightCm: round(size.heightCm),
		createdAt: Date.now(),
		synced: [],
		group: body.group,
		number: nextNumber(await listPaintings(), body.group),
		...(body.material?.trim() ? { material: body.material.trim() } : {}),
		...(color
			? { color: { shutter: color.shutter, kelvin: color.kelvin, iso: color.iso, fNumber: color.fNumber, gains: color.gains, calibratedAt: color.createdAt } }
			: {}),
		original: { photo: basename(body.file), crop: original.crop, quad: original.quad },
	}
	await savePainting(painting, { archive, thumb, original: original.jpeg })
	return c.json(painting)
})

app.get('/paintings', async (c) =>
	c.json((await listPaintings()).map((painting) => ({ ...painting, isSynced: isSynced(painting) }))),
)

app.get('/paintings/:id/thumb.jpg', async (c) => {
	const file = paintingFile(basename(c.req.param('id')), 'thumb.jpg')
	if (!existsSync(file)) return c.notFound()
	return c.body(new Uint8Array(await readFile(file)), 200, { 'content-type': 'image/jpeg' })
})

// gallery URL + upload key, edited in the capture UI (empty key = keep the current one)
app.put('/settings', async (c) => {
	const { galleryUrl, uploadKey } = await c.req.json<{ galleryUrl?: string; uploadKey?: string }>()
	await saveSettings({ ...(galleryUrl ? { galleryUrl } : {}), ...(uploadKey ? { uploadKey } : {}) })
	return c.json({ ok: true })
})

// upload everything the configured gallery doesn't have yet
app.post('/sync', async (c) => c.json(await syncAll(console.log)))

// new group (stack) in the current project
app.post('/groups', (c) => c.json({ group: addGroup() }))

// open an existing project or create a new one (e.g. "test", "attic", a client's collection)
app.post('/projects', async (c) => {
	const { name, create } = await c.req.json<{ name: string; create?: boolean }>()
	return c.json({ project: openProject(name, create) })
})

const port = 5174
const api = getRequestListener(new Hono().route('/bridge', app).fetch)
const vite = await createViteServer({
	configFile: false,
	root: 'capture',
	plugins: [vue()],
	server: { middlewareMode: true },
	appType: 'spa',
})
createServer((req, res) => (req.url?.startsWith('/bridge/') ? api(req, res) : vite.middlewares(req, res))).listen(port)
console.log(`capture tool on http://localhost:${port} (project: ${currentProject() ?? 'none'})`)
