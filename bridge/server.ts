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
import { warpToRectangle } from './warp'

const run = promisify(execFile)
const dirs = { get raw() { return projectPath('raw') } }
const calibrationFile = () => projectPath('calibration.json')
// created before every write, so deleting captures/ while the bridge runs is harmless
const ensureDirs = () => mkdir(dirs.raw, { recursive: true })

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
		galleryUrl,
		hasUploadKey: !!uploadKey,
		connection: await checkConnection(),
		unsynced,
	})
})

// remote-trigger the tethered camera and download the JPEG. One capture at a time; a camera that does not
// fire (asleep, no focus) is given up after 20 s instead of hanging for a minute.
let capturing = false
const CAPTURE_TIMEOUT = 20_000

function captureError(error: { killed?: boolean; stderr?: string; message: string }) {
	const output = error.stderr || error.message
	if (error.killed) return 'camera did not take a picture within 20 s (waking up? no focus?) — press Capture again'
	if (/Could not claim|resource busy/i.test(output))
		return 'camera is busy: another program holds it. Run `pkill -f gvfs-gphoto2-volume-monitor` or replug the camera, then try again'
	if (/No camera found|-105/i.test(output)) return 'no camera found — check USB cable and USB Connection = PC Remote'
	return output.trim().split('\n').slice(-2).join(' | ')
}

app.post('/capture', async (c) => {
	if (capturing) return c.json({ error: 'a capture is already running' }, 409)
	capturing = true
	try {
		await ensureDirs()
		const stamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\..*/, '')
		const { stdout } = await run(
			'gphoto2',
			['--capture-image-and-download', '--force-overwrite', '--filename', `${dirs.raw}/${stamp}.%C`],
			{ timeout: CAPTURE_TIMEOUT, killSignal: 'SIGKILL' },
		)
		const saved = [...stdout.matchAll(/Saving file as (\S+)/g)].map((m) => m[1]!)
		const jpeg = saved.find((file) => /\.jpe?g$/i.test(file))
		if (!jpeg)
			return c.json({ error: saved.length ? 'no JPEG captured — set the camera to JPEG' : 'camera did not take a picture — press Capture again' }, 500)
		return c.json({ file: basename(jpeg) })
	} catch (error) {
		return c.json({ error: captureError(error as { killed?: boolean; stderr?: string; message: string }) }, 500)
	} finally {
		capturing = false
	}
})

// fallback: photo taken with a phone, uploaded from the browser
app.post('/upload', async (c) => {
	await ensureDirs()
	const file = `${Date.now()}.jpg`
	await writeFile(join(dirs.raw, file), new Uint8Array(await c.req.arrayBuffer()))
	return c.json({ file })
})

app.get('/raw/:file', async (c) => {
	const file = join(dirs.raw, basename(c.req.param('file')))
	if (!existsSync(file)) return c.notFound()
	return c.body(new Uint8Array(await readFile(file)), 200, { 'content-type': 'image/jpeg' })
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
	const body = await c.req.json<{ file: string; quad: Quad; title: string; group: string; widthCm?: number; heightCm?: number }>()
	if (!listGroups().includes(body.group)) return c.json({ error: `unknown group "${body.group}"` }, 400)
	let calibration = await readCalibration()
	let size: { widthCm: number; heightCm: number }
	if (body.widthCm && body.heightCm) {
		// measured painting: (re)calibrates
		size = { widthCm: body.widthCm, heightCm: body.heightCm }
		calibration = calibrate(body.quad, size.widthCm, size.heightCm)
		await writeFile(calibrationFile(), JSON.stringify(calibration, null, '\t'))
	} else if (calibration) {
		size = estimateSizeCm(body.quad, calibration)
	} else {
		return c.json({ error: 'no calibration — measure this painting' }, 400)
	}

	const photo = join(dirs.raw, basename(body.file))
	const { width, height } = rectifiedSize(body.quad, size.widthCm, size.heightCm)
	const archive = await warpToRectangle(photo, body.quad, width, height)
	const original = await cropOriginal(photo, body.quad)

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
