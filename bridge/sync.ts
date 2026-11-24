import { readFile } from 'node:fs/promises'
import { api, getSettings, json } from './api'
import { publishWebVariants } from './images'
import { turnPainting } from './render'
import { listPaintings, paintingFile, readPainting, writePainting, type LocalPainting } from './store'

export const isSynced = (painting: { synced: string[] }) => painting.synced.includes(getSettings().galleryUrl)
// something for the next sync: a new painting, or new images of an uploaded one
export const isWaiting = (painting: LocalPainting) => !isSynced(painting) || !!painting.imagesChanged

// what the running sync is doing: paintings of this sync, and steps of the painting at hand
const STEPS = 6 // creating, rendering, 3 web sizes, done: see syncAll and publishWebVariants
export type SyncProgress = { done: number; total: number; title: string; step: string; stepsDone: number; steps: number }
export let syncProgress: SyncProgress | null = null

// Once per painting, as the gallery owns these afterwards. Already there (409): a retry after a sync that broke off
async function create(p: LocalPainting) {
	const body = { id: p.id, title: p.title, width_cm: p.widthCm, height_cm: p.heightCm, stack: p.stack, material: p.material }
	await api('/uploads', { method: 'POST', ...json(body) }).catch((error: Error) => {
		if (!error.message.includes(': 409 ')) throw error
	})
}

// Turns asked for on the gallery's /admin, of the paintings in this project: rendered turned (then waiting for upload) and
// taken back in the gallery. Paintings of other projects or laptops keep theirs. A failure leaves the turn waiting there
async function applyTurns(log: (line: string) => void) {
	const gallery = (await (await api('/paintings')).json()) as { id: string; title: string; turn?: number }[]
	for (const { id, title, turn } of gallery) {
		if (!turn) continue
		const local = await readPainting(id)
		if (!local || local.rendering) continue
		syncProgress = { done: 0, total: 0, title: title || 'Untitled', step: 'turning', stepsDone: 0, steps: 1 }
		try {
			await turnPainting(id, turn)
			await api(`/paintings/${id}/turned`, { method: 'PUT', ...json({ turns: turn }) })
			log(`↻ ${title || 'Untitled'}: turned`)
		} catch (error) {
			log(`✗ ${title || 'Untitled'}: not turned: ${(error as Error).message}`)
		}
	}
}

// Upload what is waiting in this project, in capture order: the gallery numbers paintings as they arrive, so that order is
// the physical one. Stops at the first failure, as anything after it would get the wrong #. Safe to rerun.
export async function syncAll(log: (line: string) => void = () => {}) {
	const { galleryUrl } = getSettings()
	await applyTurns(log)
	const waiting = (await listPaintings()).filter((p) => isWaiting(p) && !p.rendering).sort((a, b) => a.createdAt - b.createdAt)
	let synced = 0
	for (const painting of waiting) {
		const title = painting.title || 'Untitled'
		let stepsDone = -1
		const step = (name: string) => (syncProgress = { done: synced, total: waiting.length, title, step: name, stepsDone: ++stepsDone, steps: STEPS })
		try {
			step('creating')
			if (!isSynced(painting)) await create(painting)
			await api(`/paintings/${painting.id}`, { method: 'PUT', ...json({ width_cm: painting.widthCm, height_cm: painting.heightCm }) })
			await publishWebVariants(painting.id, await readFile(paintingFile(painting.id, 'archive.jpg')), step)
			step('finishing')
			const { imagesChanged: _, ...done } = painting
			await writePainting({ ...done, synced: [...new Set([...painting.synced, galleryUrl])] })
			synced++
			log(`✓ ${painting.title || 'Untitled'}`)
		} catch (error) {
			log(`✗ ${painting.title || 'Untitled'}: ${(error as Error).message}`)
			syncProgress = null
			return { synced, failed: [{ id: painting.id, error: (error as Error).message }] }
		}
	}
	syncProgress = null
	return { synced, failed: [] as { id: string; error: string }[] }
}
