// Offline store of captured paintings: <project>/paintings/<id>/{painting.json, archive.jpg, thumb.jpg, original.jpg}.
// Sync (bridge/sync.ts) uploads them to a gallery later; `synced` lists the gallery URLs that have them.
import { existsSync } from 'node:fs'
import { mkdir, readdir, readFile, rename, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { Quad } from '../shared/geometry'
import { oldStackName, projectPath } from './project'

export type LocalPainting = {
	id: string
	title: string
	widthCm: number
	heightCm: number
	createdAt: number
	updatedAt?: number // images rendered again after a later change
	synced: string[] // the galleries that have it
	imagesChanged?: boolean // rendered again after its upload: the next sync sends the new images and size
	// the stack to upload it to, and only that: from then on the gallery owns its stack, and its # (stack + # identify it)
	stack: string
	material?: string // e.g. "Leinwand"
	// crop of the (lens-corrected) photo around the corners (original.jpg) + corners within it, for later corrections
	// the colour calibration in the archive image; original.jpg stays without its gains. Absent: photo taken without one
	color?: { shutter: string; kelvin: number; iso: number; fNumber: number; gains: [number, number, number]; calibratedAt: number }
	original?: { photo: string; crop: { left: number; top: number; width: number; height: number }; quad: Quad }
	// saved, images still being made in the background (bridge/render.ts). Stored, so a restart carries on with it
	rendering?: { photo: string; quad: Quad; size: { widthCm: number; heightCm: number }; error?: string }
}

const root = () => projectPath('paintings')
export const paintingFile = (id: string, name: 'painting.json' | 'archive.jpg' | 'thumb.jpg' | 'original.jpg') =>
	join(root(), id, name)

export async function savePainting(painting: LocalPainting, images: { archive: Buffer; thumb: Buffer; original: Buffer } | Record<string, never> = {}) {
	await mkdir(join(root(), painting.id), { recursive: true })
	for (const [name, data] of Object.entries(images)) await writeFile(paintingFile(painting.id, `${name}.jpg` as 'archive.jpg'), data)
	await writePainting(painting)
}

// painting.json files from before a stack was just a name. Only adds the name: nothing old is removed. True: changed
function upgrade(painting: LocalPainting & { stackId?: string; groupId?: string; group?: string }) {
	if (painting.stack !== undefined) return false
	const id = painting.stackId ?? painting.groupId
	painting.stack = id !== undefined ? oldStackName(id) : (painting.group ?? 'A')
	return true
}

export async function readPainting(id: string): Promise<LocalPainting | null> {
	const file = paintingFile(id, 'painting.json')
	if (!existsSync(file)) return null
	const painting: LocalPainting = JSON.parse(await readFile(file, 'utf8'))
	upgrade(painting)
	return painting
}

// whole or not at all: the list is read while paintings are being finished
export async function writePainting(painting: LocalPainting) {
	const file = paintingFile(painting.id, 'painting.json')
	await writeFile(`${file}.tmp`, JSON.stringify(painting, null, '\t'))
	await rename(`${file}.tmp`, file)
}

export async function listPaintings(): Promise<LocalPainting[]> {
	if (!existsSync(root())) return []
	const ids = await readdir(root())
	const paintings = await Promise.all(
		ids
			.filter((id) => existsSync(paintingFile(id, 'painting.json')))
			.map(async (id) => JSON.parse(await readFile(paintingFile(id, 'painting.json'), 'utf8')) as LocalPainting),
	)
	for (const painting of paintings) if (upgrade(painting)) await writePainting(painting)
	return paintings.sort((a, b) => b.createdAt - a.createdAt)
}
