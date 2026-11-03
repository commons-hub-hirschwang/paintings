// Client for the local capture bridge (pnpm bridge), reached via the Vite dev proxy.
import type { Calibration, Camera, Quad } from '../shared/geometry'

export type BridgeStatus = {
	cameras: string[]
	project: string | null
	projects: string[]
	// below: only when a project is open
	groups: string[]
	calibration: Calibration | null
	galleryUrl: string
	hasUploadKey: boolean
	connection: { ok: true; key: string } | { ok: false; error: string }
	unsynced: number
}
// automatic corners (bridge/detect.ts); bowPx per side (top, right, bottom, left), + = bowed inwards
export type Detection = { quad: Quad; sides: { inliers: number; bowPx: number; contrast: number }[]; trusted: boolean }
export type Photo = { file: string; camera: Camera; detection: Detection | null }
export type LocalPainting = {
	id: string
	title: string
	widthCm: number
	heightCm: number
	createdAt: number
	isSynced: boolean
	group: string
	number: number
	material?: string
}

async function call<T>(path: string, init?: RequestInit): Promise<T> {
	const response = await fetch(`/bridge${path}`, init).catch(() => {
		throw new Error('bridge not reachable — is `pnpm capture` running?')
	})
	const body = await response.json().catch(() => ({ error: `${response.status} ${response.statusText}` }))
	if (!response.ok) throw new Error(body.error ?? `${response.status}`)
	return body as T
}

const json = (body: unknown): RequestInit => ({
	method: 'POST',
	body: JSON.stringify(body),
	headers: { 'content-type': 'application/json' },
})

export const bridge = {
	status: () => call<BridgeStatus>('/status'),
	capture: () => call<Photo>('/capture', { method: 'POST' }),
	upload: (file: File) => call<Photo>('/upload', { method: 'POST', body: file }),
	detect: (file: string, quad: Quad) => call<Detection>('/detect', json({ file, quad })),
	forgetCalibration: () => call('/calibration', { method: 'DELETE' }),
	saveSettings: (settings: { galleryUrl: string; uploadKey: string }) =>
		call('/settings', { ...json(settings), method: 'PUT' }),
	openProject: (name: string, create = false) => call<{ project: string }>('/projects', json({ name, create })),
	process: (body: {
		file: string
		quad: Quad
		bows?: number[]
		title: string
		group: string
		material?: string
		widthCm?: number
		heightCm?: number
	}) =>
		call<LocalPainting>('/process', json(body)),
	addGroup: () => call<{ group: string }>('/groups', { method: 'POST' }),
	paintings: () => call<LocalPainting[]>('/paintings'),
	sync: () => call<{ synced: number; failed: { id: string; error: string }[] }>('/sync', { method: 'POST' }),
	thumbUrl: (id: string) => `/bridge/paintings/${id}/thumb.jpg`,
	photoUrl: (file: string) => `/bridge/photo/${encodeURIComponent(file)}`,
}
