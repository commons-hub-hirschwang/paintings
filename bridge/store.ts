// Offline store of captured paintings: <project>/paintings/<id>/{painting.json, archive.jpg, thumb.jpg, original.jpg}.
// Sync (bridge/sync.ts) uploads them to a gallery later; `synced` lists the gallery URLs that have them.
import { existsSync } from 'node:fs'
import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { Quad } from '../shared/geometry'
import { legacyGroupId, projectPath } from './project'

export type LocalPainting = {
	id: string
	title: string
	widthCm: number
	heightCm: number
	createdAt: number
	updatedAt?: number // images rendered again after a later change
	synced: string[]
	// stack (id of a group in groups.json) and position in it: "Keller #3"
	groupId: string
	number: number
	material?: string // e.g. "Leinwand"
	// crop of the (lens-corrected) photo around the corners (original.jpg) + corners within it, for later corrections
	// the colour calibration in the archive image; original.jpg stays without its gains. Absent: photo taken without one
	color?: { shutter: string; kelvin: number; iso: number; fNumber: number; gains: [number, number, number]; calibratedAt: number }
	original?: { photo: string; crop: { left: number; top: number; width: number; height: number }; quad: Quad }
}

const root = () => projectPath('paintings')
export const paintingFile = (id: string, name: 'painting.json' | 'archive.jpg' | 'thumb.jpg' | 'original.jpg') =>
	join(root(), id, name)

export async function savePainting(painting: LocalPainting, images: { archive: Buffer; thumb: Buffer; original: Buffer }) {
	await mkdir(join(root(), painting.id), { recursive: true })
	for (const [name, data] of Object.entries(images)) await writeFile(paintingFile(painting.id, `${name}.jpg` as 'archive.jpg'), data)
	await writePainting(painting)
}

// next free number in a group: #0, #1, …
export const nextNumber = (paintings: LocalPainting[], groupId: string) =>
	Math.max(-1, ...paintings.filter((p) => p.groupId === groupId).map((p) => p.number)) + 1

export async function readPainting(id: string): Promise<LocalPainting | null> {
	const file = paintingFile(id, 'painting.json')
	return existsSync(file) ? JSON.parse(await readFile(file, 'utf8')) : null
}

export const writePainting = (painting: LocalPainting) =>
	writeFile(paintingFile(painting.id, 'painting.json'), JSON.stringify(painting, null, '\t'))

export async function listPaintings(): Promise<LocalPainting[]> {
	if (!existsSync(root())) return []
	const ids = await readdir(root())
	const paintings = await Promise.all(
		ids
			.filter((id) => existsSync(paintingFile(id, 'painting.json')))
			.map(async (id) => JSON.parse(await readFile(paintingFile(id, 'painting.json'), 'utf8')) as LocalPainting),
	)
	// paintings from when groups were just a letter
	for (const painting of paintings as (LocalPainting & { group?: string })[]) {
		if (painting.group === undefined) continue
		painting.groupId = legacyGroupId(painting.group)
		delete painting.group
		await writePainting(painting)
	}
	// paintings from before groups existed: numbered into group A by capture time
	for (const painting of paintings.filter((p) => p.groupId === undefined).sort((a, b) => a.createdAt - b.createdAt)) {
		painting.number = nextNumber(paintings, legacyGroupId('A'))
		painting.groupId = legacyGroupId('A')
		await writePainting(painting)
	}
	return paintings.sort((a, b) => b.createdAt - a.createdAt)
}
