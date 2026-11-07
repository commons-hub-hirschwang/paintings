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
import { calibrate, estimateSizeCm, type Calibration, type Quad } from '../shared/geometry'
import sharp from 'sharp'
import { checkConnection, fetchStacks, getSettings, saveSettings } from './api'
import { listPaintings, nextStackOrder, paintingFile, readPainting, savePainting, withStackIndex } from './store'
import { changePainting, correctedPhoto, dirs, ensureDirs, paintingSource, queueRender, rendersDone, resumeRenders, roundCm, type PaintingChange } from './render'
import { isSynced, syncAll } from './sync'
import { addStack, applyStackNames, currentProject, listProjects, listStacks, openProject, projectPath, setOutOfStack } from './project'
import { readOriented } from './warp'
import { applyGains, calibrateColor, clippedShare, colorFile, correctionFor, DEFAULT_ISO, readColorCalibration, shotFile, takeReference, type Box, type ColorCalibration, type Gains } from './color'
import { ensureLocked, exclusive, exposureMismatch, forgetCameraState, shoot } from './tether'
import { exposureOf } from './camera'
import { detectCorners, measureBows, trusted } from './detect'

const run = promisify(execFile)
const calibrationFile = () => projectPath('calibration.json')
// corners of the last saved painting: the next one usually stands at the same spot (detection hint)
let lastQuad: { quad: Quad; width: number; height: number } | null = null

// the photo as the editor shows it, with the colour correction. Made while the corners are being detected, so it is ready
// when the editor asks for it.
let view: { key: string; jpeg: Promise<Buffer> } | null = null
function photoView(path: string, gains: Gains) {
	const key = JSON.stringify([path, gains])
	if (view?.key === key) return view.jpeg
	const jpeg = readOriented(path).then(({ data, width, height }) => sharp(applyGains(data, gains), { raw: { width, height, channels: 3 } }).jpeg({ quality: 90 }).toBuffer())
	const current = (view = { key, jpeg })
	jpeg.catch(() => {
		if (view === current) view = null
	})
	return jpeg
}

async function photoResult(file: string) {
	const photo = (await correctedPhoto(file))!
	correctionFor(photo.raw).then((color) => color && photoView(photo.path, color.gains)).catch(console.error)
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
	const connection = await checkConnection()
	const known = connection.ok ? await fetchStacks() : null
	if (known) {
		applyStackNames(known.names)
		setOutOfStack(known.out)
	}
	return c.json({
		cameras,
		project,
		projects: listProjects(),
		stacks: listStacks(),
		calibration: await readCalibration(),
		color: await readColorCalibration(),
		galleryUrl,
		hasUploadKey: !!uploadKey,
		connection,
		unsynced,
	})
})

// what the photographer should know about a shot: settings that didn't hold, blown-out highlights in the painting
async function shotWarnings(raw: string, image: Awaited<ReturnType<typeof readOriented>>, color: ColorCalibration, detection: Awaited<ReturnType<typeof photoResult>>['detection']) {
	const mismatch = exposureMismatch(await exposureOf(raw), color)
	if (mismatch.length) forgetCameraState() // set everything again before the next capture
	const warnings = mismatch.length ? [`Not the calibrated settings: ${mismatch.join(', ')} — not colour corrected.`] : []
	// measured as it will be saved (with the gains), at full resolution: the painting, or the whole photo if it wasn't found
	const xs = detection?.quad.map((p) => p.x) ?? [0, image.width]
	const ys = detection?.quad.map((p) => p.y) ?? [0, image.height]
	const box = { left: Math.min(...xs), top: Math.min(...ys), width: Math.max(...xs) - Math.min(...xs), height: Math.max(...ys) - Math.min(...ys) }
	const clipped = clippedShare(image, box, mismatch.length ? undefined : color.gains)
	if (clipped > 0.0001)
		warnings.push(`Overexposed: ${(clipped * 100).toFixed(2)} % of the ${detection ? 'painting' : 'photo'} (red stripes) has lost its detail.`)
	return warnings
}

// remote-trigger the tethered camera with the calibrated settings, keep RAW + JPEG
app.post('/capture', (c) =>
	exclusive(async () => {
		const color = await readColorCalibration()
		if (!color) return c.json({ error: 'calibrate colour first' }, 400)
		await ensureDirs()
		await ensureLocked({ shutter: color.shutter, kelvin: color.kelvin, iso: color.iso })
		const shot = await shoot(dirs.raw)
		// all at once: each is waiting for something else most of the time
		const [result, image] = await Promise.all([photoResult(basename(shot)), readOriented(shot)])
		return c.json({ ...result, warnings: await shotWarnings(shot, image, color, result.detection) })
	}),
)

// colour calibration: reference photo → mark the white area → calibrate (see color.ts)
app.post('/color/reference', async (c) => {
	const { iso } = await c.req.json<{ iso?: number }>()
	return c.json(await exclusive(() => takeReference(iso ?? DEFAULT_ISO)))
})
app.post('/color/calibrate', async (c) => {
	const { file, box, white } = await c.req.json<{ file: string; box: Box; white?: number }>()
	return c.json(await exclusive(() => calibrateColor(file, box, white)))
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
	// shown as it will be saved; a saved painting (?painting=id) keeps the colour it was photographed with
	const id = c.req.query('painting')
	const gains = id ? (await readPainting(basename(id)))?.color?.gains : (await correctionFor(photo.raw))?.gains
	if (!gains) return c.body(new Uint8Array(await readFile(photo.path)), 200, { 'content-type': 'image/jpeg' })
	return c.body(new Uint8Array(await photoView(photo.path, gains)), 200, { 'content-type': 'image/jpeg' })
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

// how the sides curve between the given corners, automatic or placed by hand
app.post('/bows', async (c) => {
	const { file, quad } = await c.req.json<{ file: string; quad: Quad }>()
	const photo = await correctedPhoto(file)
	if (!photo) return c.notFound()
	return c.json(await measureBows(photo.path, quad))
})

// "same distance from camera to painting as before?" — no → forget calibration
app.delete('/calibration', async (c) => {
	await rm(calibrationFile(), { force: true })
	return c.json({ ok: true })
})

const forUi = async (id: string) => {
	const painting = withStackIndex(await listPaintings()).find((p) => p.id === id)!
	return { ...painting, isSynced: isSynced(painting) }
}

// corners selected → stored locally (works offline; uploaded by /sync). Answers right away, the images follow in the
// background (see render.ts); everything the next photo depends on is settled here.
app.post('/process', async (c) => {
	await ensureDirs()
	const body = await c.req.json<{
		file: string
		quad: Quad
		title: string
		stackId: string
		material?: string
		widthCm?: number
		heightCm?: number
	}>()
	if (!listStacks().some((s) => s.id === body.stackId)) return c.json({ error: `unknown stack "${body.stackId}"` }, 400)
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

	const color = await correctionFor(photo.raw)
	lastQuad = { quad: body.quad, width: camera.width, height: camera.height }
	const painting = {
		id: crypto.randomUUID(),
		title: body.title,
		widthCm: roundCm(size.widthCm),
		heightCm: roundCm(size.heightCm),
		createdAt: Date.now(),
		synced: [],
		stackId: body.stackId,
		stackOrder: nextStackOrder(await listPaintings(), body.stackId),
		...(body.material?.trim() ? { material: body.material.trim() } : {}),
		...(color
			? { color: { shutter: color.shutter, kelvin: color.kelvin, iso: color.iso, fNumber: color.fNumber, gains: color.gains, calibratedAt: color.createdAt } }
			: {}),
		rendering: { photo: basename(body.file), quad: body.quad, size },
	}
	await savePainting(painting)
	queueRender(painting.id)
	return c.json({ painting: await forUi(painting.id), calibration })
})

app.get('/paintings', async (c) =>
	c.json(withStackIndex(await listPaintings()).map((painting) => ({ ...painting, isSynced: isSynced(painting) }))),
)

// bring up a saved painting in the editor
app.get('/paintings/:id/source', async (c) => c.json(await paintingSource(basename(c.req.param('id')))))

app.put('/paintings/:id', async (c) => {
	const painting = await changePainting(basename(c.req.param('id')), await c.req.json<PaintingChange>())
	return c.json(await forUi(painting.id))
})

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
app.post('/sync', async (c) => {
	await rendersDone()
	return c.json(await syncAll(console.log))
})

// new stack in the current project
app.post('/stacks', async (c) => c.json(addStack((await c.req.json<{ name: string }>()).name)))

// open an existing project or create a new one (e.g. "test", "attic", a client's collection)
app.post('/projects', async (c) => {
	const { name, create } = await c.req.json<{ name: string; create?: boolean }>()
	await rendersDone()
	const project = openProject(name, create)
	await resumeRenders()
	return c.json({ project })
})

if (currentProject()) await resumeRenders()

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
