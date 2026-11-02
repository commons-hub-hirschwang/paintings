// Offline store of captured paintings: captures/paintings/<id>/{painting.json, archive.jpg, thumb.jpg}.
// Sync (bridge/sync.ts) uploads them to a gallery later; `synced` lists the gallery URLs that have them.
import { existsSync } from 'node:fs'
import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

export type LocalPainting = {
	id: string
	title: string
	widthCm: number
	heightCm: number
	createdAt: number
	synced: string[]
}

const root = 'captures/paintings'
export const paintingFile = (id: string, name: 'painting.json' | 'archive.jpg' | 'thumb.jpg') => join(root, id, name)

export async function savePainting(painting: LocalPainting, archive: Buffer, thumb: Buffer) {
	await mkdir(join(root, painting.id), { recursive: true })
	await writeFile(paintingFile(painting.id, 'archive.jpg'), archive)
	await writeFile(paintingFile(painting.id, 'thumb.jpg'), thumb)
	await writePainting(painting)
}

export const writePainting = (painting: LocalPainting) =>
	writeFile(paintingFile(painting.id, 'painting.json'), JSON.stringify(painting, null, '\t'))

export async function listPaintings(): Promise<LocalPainting[]> {
	if (!existsSync(root)) return []
	const ids = await readdir(root)
	const paintings = await Promise.all(
		ids
			.filter((id) => existsSync(paintingFile(id, 'painting.json')))
			.map(async (id) => JSON.parse(await readFile(paintingFile(id, 'painting.json'), 'utf8')) as LocalPainting),
	)
	return paintings.sort((a, b) => b.createdAt - a.createdAt)
}
