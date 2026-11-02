import { readFile } from 'node:fs/promises'
import { api, getSettings, json } from './api'
import { publishWebVariants } from './images'
import { listPaintings, paintingFile, writePainting } from './store'

export const isSynced = (painting: { synced: string[] }) => painting.synced.includes(getSettings().galleryUrl)

// Upload all local paintings the gallery (GALLERY_URL) doesn't have yet. Idempotent: safe to rerun after failures.
export async function syncAll(log: (line: string) => void = () => {}) {
	const { galleryUrl } = getSettings()
	const todo = (await listPaintings()).filter((p) => !isSynced(p))
	const failed: { id: string; error: string }[] = []
	for (const painting of todo) {
		try {
			const archive = await readFile(paintingFile(painting.id, 'archive.jpg'))
			await api('/paintings', {
				method: 'POST',
				...json({ id: painting.id, title: painting.title, width_cm: painting.widthCm, height_cm: painting.heightCm }),
			})
			await api(`/paintings/${painting.id}/images/archive`, {
				method: 'PUT',
				body: new Uint8Array(archive),
				headers: { 'content-type': 'image/jpeg' },
			})
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
