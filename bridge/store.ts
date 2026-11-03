// Offline store of captured paintings: <project>/paintings/<id>/{painting.json, archive.jpg, thumb.jpg, original.jpg}.
// Sync (bridge/sync.ts) uploads them to a gallery later; `synced` lists the gallery URLs that have them.
import { existsSync } from 'node:fs'
import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { Quad } from '../shared/geometry'
import { projectPath } from './project'

export type LocalPainting = {
	id: string
	title: string
	widthCm: number
	heightCm: number
	createdAt: number
	synced: string[]
	// stack and position in it: "A #3"
	group: string
	number: number
	material?: string // e.g. "Leinwand"
	// crop of the (lens-corrected) photo around the corners (original.jpg) + corners within it, for later corrections
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
export const nextNumber = (paintings: LocalPainting[], group: string) =>
	Math.max(-1, ...paintings.filter((p) => p.group === group).map((p) => p.number)) + 1

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
	// paintings from before groups existed: numbered into group A by capture time
	for (const painting of paintings.filter((p) => p.group === undefined).sort((a, b) => a.createdAt - b.createdAt)) {
		painting.number = nextNumber(paintings, 'A')
		painting.group = 'A'
		await writePainting(painting)
	}
	return paintings.sort((a, b) => b.createdAt - a.createdAt)
}
