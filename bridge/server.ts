// Local capture bridge: runs on the laptop the camera is plugged into (pnpm bridge).
// The capture UI reaches it via the Vite proxy at /bridge.
import { execFile } from 'node:child_process'
import { existsSync } from 'node:fs'
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { basename, join } from 'node:path'
import { promisify } from 'node:util'
import { serve } from '@hono/node-server'
import { Hono } from 'hono'
import { calibrate, estimateSizeCm, rectifiedSize, type Calibration, type Quad } from '../shared/geometry'
import sharp from 'sharp'
import { webVariants } from '../shared/image-variants'
import { galleryUrl } from './api'
import { listPaintings, paintingFile, savePainting } from './store'
import { isSynced, syncAll } from './sync'
import { warpToRectangle } from './warp'

const run = promisify(execFile)
const dirs = { raw: 'captures/raw' }
const calibrationFile = 'captures/calibration.json'
// created before every write, so deleting captures/ while the bridge runs is harmless
const ensureDirs = () => Promise.all(Object.values(dirs).map((dir) => mkdir(dir, { recursive: true })))

const readCalibration = async (): Promise<Calibration | null> =>
	existsSync(calibrationFile) ? JSON.parse(await readFile(calibrationFile, 'utf8')) : null

const app = new Hono()
app.onError((error, c) => {
	console.error(error)
	return c.json({ error: error.message }, 500)
})

app.get('/status', async (c) => {
	const { stdout } = await run('gphoto2', ['--auto-detect']).catch(() => ({ stdout: '' }))
	// output: header, dashes, then "Model   Port" lines
	const cameras = stdout.split('\n').slice(2).map((line) => line.trim()).filter(Boolean)
	const unsynced = (await listPaintings()).filter((p) => !isSynced(p)).length
	return c.json({ cameras, calibration: await readCalibration(), galleryUrl, unsynced })
})

// remote-trigger the tethered camera and download the JPEG
app.post('/capture', async (c) => {
	await ensureDirs()
	const stamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\..*/, '')
	const { stdout, stderr } = await run('gphoto2', ['--capture-image-and-download', '--force-overwrite', '--filename', `${dirs.raw}/${stamp}.%C`])
	const saved = [...stdout.matchAll(/Saving file as (\S+)/g)].map((m) => m[1]!)
	const jpeg = saved.find((file) => /\.jpe?g$/i.test(file))
	if (!jpeg) {
		const hint = saved.length ? 'set the camera to JPEG' : 'camera did not take a picture (focus? asleep?) — try again'
		return c.json({ error: `no JPEG captured: ${hint}. gphoto2: ${(stderr || stdout).trim().split('\n').slice(-3).join(' | ')}` }, 500)
	}
	return c.json({ file: basename(jpeg) })
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
	await rm(calibrationFile, { force: true })
	return c.json({ ok: true })
})

// corners selected → rectify and store locally (works offline; uploaded by /sync)
app.post('/process', async (c) => {
	await ensureDirs()
	const body = await c.req.json<{ file: string; quad: Quad; title: string; widthCm?: number; heightCm?: number }>()
	let calibration = await readCalibration()
	let size: { widthCm: number; heightCm: number }
	if (body.widthCm && body.heightCm) {
		// measured painting: (re)calibrates
		size = { widthCm: body.widthCm, heightCm: body.heightCm }
		calibration = calibrate(body.quad, size.widthCm, size.heightCm)
		await writeFile(calibrationFile, JSON.stringify(calibration, null, '\t'))
	} else if (calibration) {
		size = estimateSizeCm(body.quad, calibration)
	} else {
		return c.json({ error: 'no calibration — measure this painting' }, 400)
	}

	const { width, height } = rectifiedSize(body.quad, size.widthCm, size.heightCm)
	const archive = await warpToRectangle(join(dirs.raw, basename(body.file)), body.quad, width, height)

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
	}
	await savePainting(painting, archive, thumb)
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

// upload everything not yet in GALLERY_URL
app.post('/sync', async (c) => c.json(await syncAll(console.log)))

const port = 5174
serve({ fetch: app.fetch, port })
console.log(`bridge on http://localhost:${port}, syncs to ${galleryUrl}`)
