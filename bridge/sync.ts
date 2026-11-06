import { existsSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { api, getSettings, json } from './api'
import { publishWebVariants } from './images'
import { listGroups } from './project'
import { listPaintings, paintingFile, writePainting, type LocalPainting } from './store'

export const isSynced = (painting: { synced: string[] }) => painting.synced.includes(getSettings().galleryUrl)

const upload = async (id: string, variant: 'archive' | 'original', file: Buffer) =>
	api(`/paintings/${id}/images/${variant}`, { method: 'PUT', body: new Uint8Array(file), headers: { 'content-type': 'image/jpeg' } })

const postPainting = (p: LocalPainting) =>
	api('/paintings', {
		method: 'POST',
		...json({ id: p.id, title: p.title, width_cm: p.widthCm, height_cm: p.heightCm, group_id: p.groupId, number: p.number, material: p.material }),
	})

// Upload all local paintings the gallery doesn't have yet; metadata (group, number, size, material) of the others is
// re-sent (cheap; the title only counts on first upload). Idempotent: safe to rerun after failures.
export async function syncAll(log: (line: string) => void = () => {}) {
	const { galleryUrl } = getSettings()
	const paintings = await listPaintings()
	// groups first: paintings refer to them
	await api('/groups', { method: 'PUT', ...json(listGroups()) })
	for (const painting of paintings.filter(isSynced)) await postPainting(painting)
	const todo = paintings.filter((p) => !isSynced(p))
	const failed: { id: string; error: string }[] = []
	for (const painting of todo) {
		try {
			const archive = await readFile(paintingFile(painting.id, 'archive.jpg'))
			await postPainting(painting)
			await upload(painting.id, 'archive', archive)
			if (existsSync(paintingFile(painting.id, 'original.jpg')))
				await upload(painting.id, 'original', await readFile(paintingFile(painting.id, 'original.jpg')))
			await publishWebVariants(painting.id, archive)
			await writePainting({ ...painting, synced: [...painting.synced, galleryUrl] })
			log(`✓ ${painting.title || 'Untitled'}`)
		} catch (error) {
			failed.push({ id: painting.id, error: (error as Error).message })
			log(`✗ ${painting.title || 'Untitled'}: ${(error as Error).message}`)
		}
	}
	return { synced: todo.length - failed.length, failed }
}
