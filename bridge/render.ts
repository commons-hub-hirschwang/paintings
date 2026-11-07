// Turning a photo + corners into a painting's stored images, for new captures and for later changes to them.
import { existsSync } from 'node:fs'
import { mkdir, writeFile } from 'node:fs/promises'
import { basename, join } from 'node:path'
import sharp from 'sharp'
import { rectifiedSize, type Quad } from '../shared/geometry'
import { archive as archiveSettings, webVariants } from '../shared/image-variants'
import { cameraOf } from './camera'
import { lensOf } from './lens'
import { applyGains } from './color'
import { measureBows } from './detect'
import { listStacks, projectPath } from './project'
import { correctLens, warpToRectangle } from './warp'
import { listPaintings, nextStackOrder, readPainting, savePainting, writePainting, type LocalPainting } from './store'

// raw: the camera's photos (untouched); corrected: lens-corrected copies, in which corners are picked
export const dirs = { get raw() { return projectPath('raw') }, get corrected() { return projectPath('corrected') } }
// created before every write, so deleting captures/ while the bridge runs is harmless
export const ensureDirs = () => Promise.all([mkdir(dirs.raw, { recursive: true }), mkdir(dirs.corrected, { recursive: true })])

// the photo the corner editor shows (lens-corrected when the lens has a profile), created on demand
export async function correctedPhoto(file: string) {
	const raw = join(dirs.raw, basename(file))
	if (!existsSync(raw)) return null
	const camera = await cameraOf(raw)
	const lens = lensOf(camera)
	if (!lens) return { path: raw, camera, raw }
	const path = join(dirs.corrected, `${basename(file)}.jpg`)
	if (!existsSync(path)) {
		await ensureDirs()
		await writeFile(path, await correctLens(raw, camera))
	}
	return { path, camera, raw }
}

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
	const jpeg = await sharp(upright.data).extract(crop).jpeg({ quality: archiveSettings.quality }).toBuffer()
	return { jpeg, crop, quad: quad.map((p) => ({ x: p.x - left, y: p.y - top })) as Quad }
}

type Photo = NonNullable<Awaited<ReturnType<typeof correctedPhoto>>>
type Size = { widthCm: number; heightCm: number }

// archive (rectified, curved sides straightened, colour applied), thumb, and the crop kept for later corrections
export async function renderImages(photo: Photo, quad: Quad, size: Size, gains?: [number, number, number]) {
	const { width, height } = rectifiedSize(quad, size.widthCm, size.heightCm)
	const bows = (await measureBows(photo.path, quad)).map((side) => side.bowPx)
	const archive = await warpToRectangle(photo.raw, quad, width, height, photo.camera, bows, gains ? (data) => applyGains(data, gains) : undefined)
	const original = await cropOriginal(photo.path, quad)
	const { maxSize, quality } = webVariants.thumb
	const thumb = await sharp(archive).resize({ width: maxSize, height: maxSize, fit: 'inside' }).jpeg({ quality }).toBuffer()
	return { archive, thumb, original }
}

// A saved painting's images are made in the background, one painting at a time and in the order they were saved, so the
// next photo can be taken right away. painting.json comes first (with `rendering`): the number is taken, and nothing is
// lost if the bridge stops; the next start carries on. Failed: says so in the list, tried again on the next start.
let renders = Promise.resolve()
const queued = new Set<string>()

async function renderInBackground(id: string) {
	const painting = await readPainting(id)
	if (!painting?.rendering) return
	const { rendering, ...finished } = painting
	try {
		const photo = await correctedPhoto(rendering.photo)
		if (!photo) throw new Error(`photo "${rendering.photo}" is no longer there`)
		const { archive, thumb, original } = await renderImages(photo, rendering.quad, rendering.size, painting.color?.gains)
		await savePainting({ ...finished, original: { photo: rendering.photo, crop: original.crop, quad: original.quad } }, { archive, thumb, original: original.jpeg })
	} catch (error) {
		console.error(error)
		await writePainting({ ...painting, rendering: { ...rendering, error: (error as Error).message } })
	}
}

export function queueRender(id: string) {
	if (queued.has(id)) return
	queued.add(id)
	renders = renders.then(() => renderInBackground(id).catch(console.error)).finally(() => queued.delete(id))
}

// paintings left unfinished by the last run, or that failed
export async function resumeRenders() {
	for (const painting of (await listPaintings()).filter((p) => p.rendering).reverse()) {
		if (painting.rendering!.error) {
			const { error: _, ...rendering } = painting.rendering!
			await writePainting({ ...painting, rendering })
		}
		queueRender(painting.id)
	}
}

// before anything that needs all paintings finished; before changing projects, as paths follow the current project
export const rendersDone = () => renders

export const roundCm = (cm: number) => Math.round(cm * 10) / 10

// a saved painting's corners in the whole photo
const cornersOf = ({ quad, crop }: NonNullable<LocalPainting['original']>) => quad.map((p) => ({ x: p.x + crop.left, y: p.y + crop.top })) as Quad

// what the corner editor needs to bring up a saved painting
export async function paintingSource(id: string) {
	const painting = await readPainting(id)
	if (!painting?.original) throw new Error('this painting was saved without its photo data')
	const photo = await correctedPhoto(painting.original.photo)
	if (!photo) throw new Error(`photo "${painting.original.photo}" is no longer there`)
	return { file: painting.original.photo, camera: photo.camera, quad: cornersOf(painting.original) }
}

export type PaintingChange = Size & { quad: Quad; stackId: string; material?: string; title?: string }

// Change a saved painting. Its colour stays the one it was photographed with, and a size entered here doesn't touch
// the distance calibration. Moved to another stack: to its end. New pixels (corners, turn, size): rendered again from the photo, and
// uploaded again by the next sync.
export async function changePainting(id: string, change: PaintingChange) {
	const painting = await readPainting(id)
	if (painting?.rendering) throw new Error('this painting is still being rendered')
	if (!painting?.original) throw new Error('this painting was saved without its photo data')
	if (!listStacks().some((s) => s.id === change.stackId)) throw new Error(`unknown stack "${change.stackId}"`)
	const { widthCm, heightCm } = { widthCm: roundCm(change.widthCm), heightCm: roundCm(change.heightCm) }
	const { material: _, ...rest } = painting
	const material = change.material?.trim()
	const changed: LocalPainting = {
		...rest,
		title: change.title ?? painting.title,
		stackId: change.stackId,
		stackOrder: change.stackId === painting.stackId ? painting.stackOrder : nextStackOrder(await listPaintings(), change.stackId),
		...(material ? { material } : {}),
		widthCm,
		heightCm,
	}
	const before = cornersOf(painting.original)
	const sameCorners = change.quad.every((p, k) => Math.hypot(p.x - before[k]!.x, p.y - before[k]!.y) < 0.01)
	if (sameCorners && widthCm === painting.widthCm && heightCm === painting.heightCm) {
		await writePainting(changed)
		return changed
	}
	const photo = await correctedPhoto(painting.original.photo)
	if (!photo) throw new Error(`photo "${painting.original.photo}" is no longer there`)
	const { archive, thumb, original } = await renderImages(photo, change.quad, { widthCm, heightCm }, painting.color?.gains)
	const rendered = {
		...changed,
		updatedAt: Date.now(),
		synced: [],
		original: { photo: painting.original.photo, crop: original.crop, quad: original.quad },
	}
	await savePainting(rendered, { archive, thumb, original: original.jpeg })
	return rendered
}
