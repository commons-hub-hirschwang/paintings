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
import { api, galleryUrl, json } from './api'
import { publishWebVariants } from './images'
import { warpToRectangle } from './warp'

const run = promisify(execFile)
const dirs = { raw: 'captures/raw', archive: 'captures/archive' }
const calibrationFile = 'captures/calibration.json'
for (const dir of Object.values(dirs)) await mkdir(dir, { recursive: true })

const readCalibration = async (): Promise<Calibration | null> =>
	existsSync(calibrationFile) ? JSON.parse(await readFile(calibrationFile, 'utf8')) : null

const app = new Hono()

app.get('/status', async (c) => {
	const { stdout } = await run('gphoto2', ['--auto-detect']).catch(() => ({ stdout: '' }))
	// output: header, dashes, then "Model   Port" lines
	const cameras = stdout.split('\n').slice(2).map((line) => line.trim()).filter(Boolean)
	return c.json({ cameras, calibration: await readCalibration(), galleryUrl })
})

// remote-trigger the tethered camera and download the JPEG
app.post('/capture', async (c) => {
	const stamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\..*/, '')
	const { stdout } = await run('gphoto2', ['--capture-image-and-download', '--force-overwrite', '--filename', `${dirs.raw}/${stamp}.%C`])
	const saved = [...stdout.matchAll(/Saving file as (\S+)/g)].map((m) => m[1]!)
	const jpeg = saved.find((file) => /\.jpe?g$/i.test(file))
	if (!jpeg) return c.json({ error: `no JPEG captured (got ${saved.join(', ') || 'nothing'}) — set the camera to JPEG` }, 500)
	return c.json({ file: basename(jpeg) })
})

// fallback: photo taken with a phone, uploaded from the browser
app.post('/upload', async (c) => {
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

// corners selected → rectify, archive, create painting, publish web variants
app.post('/process', async (c) => {
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

	const round = (cm: number) => Math.round(cm * 10) / 10
	const { id } = (await (
		await api('/paintings', { method: 'POST', ...json({ title: body.title, width_cm: round(size.widthCm), height_cm: round(size.heightCm) }) })
	).json()) as { id: string }
	await writeFile(join(dirs.archive, `${id}.jpg`), archive) // local backup of the master
	await api(`/paintings/${id}/images/archive`, { method: 'PUT', body: new Uint8Array(archive), headers: { 'content-type': 'image/jpeg' } })
	await publishWebVariants(id, archive)

	return c.json({ id, widthCm: round(size.widthCm), heightCm: round(size.heightCm), width, height })
})

const port = 5174
serve({ fetch: app.fetch, port })
console.log(`bridge on http://localhost:${port}, publishing to ${galleryUrl}`)
