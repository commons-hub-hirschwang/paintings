// Offline store of captured paintings: <project>/paintings/<id>/{painting.json, archive.jpg, thumb.jpg, original.jpg}.
// Sync (bridge/sync.ts) uploads them to a gallery later; `synced` lists the gallery URLs that have them.
import { existsSync } from 'node:fs'
import { mkdir, readdir, readFile, rename, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { Quad } from '../shared/geometry'
import { legacyStackId, listOutOfStack, projectPath } from './project'

export type LocalPainting = {
	id: string
	title: string
	widthCm: number
	heightCm: number
	createdAt: number
	updatedAt?: number // images rendered again after a later change
	synced: string[]
	// stack (id in stacks.json) and place in it. The order only sorts and never changes, so it can have gaps; what people
	// see is the index counted from it (withStackIndex): "Keller #3"
	stackId: string
	stackOrder: number
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

// a new painting goes on the end of its stack. Paintings taken out still count here: they could be put back
export const nextStackOrder = (paintings: LocalPainting[], stackId: string) =>
	Math.max(-1, ...paintings.filter((p) => p.stackId === stackId).map((p) => p.stackOrder)) + 1

// position in the physical stack: how many paintings before it are still there; null: no longer in it.
// The same count as in the gallery (server/stacks.ts)
export function withStackIndex<P extends LocalPainting>(paintings: P[]) {
	const out = new Set(listOutOfStack())
	const inStack = paintings.filter((p) => !out.has(p.id))
	return paintings.map((p) => ({
		...p,
		stackIndex: out.has(p.id) ? null : inStack.filter((q) => q.stackId === p.stackId && q.stackOrder < p.stackOrder).length,
	}))
}

// painting.json files from before stacks had their name; true: changed
function upgrade(painting: LocalPainting & { group?: string; groupId?: string; number?: number }) {
	const old = painting.group !== undefined || painting.groupId !== undefined || painting.number !== undefined
	if (painting.group !== undefined) painting.stackId = legacyStackId(painting.group) // when they were just a letter
	if (painting.groupId !== undefined) painting.stackId = painting.groupId
	if (painting.number !== undefined) painting.stackOrder = painting.number
	delete painting.group
	delete painting.groupId
	delete painting.number
	return old
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
	// paintings from before stacks existed: into stack A by capture time
	for (const painting of paintings.filter((p) => p.stackId === undefined).sort((a, b) => a.createdAt - b.createdAt)) {
		painting.stackOrder = nextStackOrder(paintings, legacyStackId('A'))
		painting.stackId = legacyStackId('A')
		await writePainting(painting)
	}
	return paintings.sort((a, b) => b.createdAt - a.createdAt)
}
