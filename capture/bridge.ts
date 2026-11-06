// Client for the local capture bridge (pnpm bridge), reached via the Vite dev proxy.
import type { Calibration, Camera, Quad } from '../shared/geometry'

export type Group = { id: string; name: string }
export type BridgeStatus = {
	cameras: string[]
	project: string | null
	projects: string[]
	// below: only when a project is open
	groups: Group[]
	calibration: Calibration | null
	color: ColorCalibration | null
	galleryUrl: string
	hasUploadKey: boolean
	connection: { ok: true; key: string } | { ok: false; error: string }
	unsynced: number
}
// automatic corners (bridge/detect.ts)
export type Detection = { quad: Quad; trusted: boolean }
// curve of a side between its corners: + = inwards; clear: false = no edge found, counts as straight
export type Bow = { bowPx: number; clear: boolean }
export type Photo = { file: string; camera: Camera; detection: Detection | null; warnings: string[] }
export type Box = { left: number; top: number; width: number; height: number }
export type ColorCalibration = {
	shutter: string
	kelvin: number
	iso: number
	fNumber: number
	gains: [number, number, number]
	box: Box
	target?: number
	white: number
	createdAt: number
	warnings: string[]
}
export type LocalPainting = {
	id: string
	title: string
	widthCm: number
	heightCm: number
	createdAt: number
	updatedAt?: number
	isSynced: boolean
	groupId: string
	number: number
	material?: string
	original?: unknown // present: can be brought up again
}
export type PaintingChange = { quad: Quad; groupId: string; material?: string; title?: string; widthCm: number; heightCm: number }

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
	bows: (file: string, quad: Quad) => call<Bow[]>('/bows', json({ file, quad })),
	colorReference: (iso: number) => call<{ file: string; previous: ColorCalibration | null }>('/color/reference', json({ iso })),
	calibrateColor: (file: string, box: Box, white: number) => call<ColorCalibration>('/color/calibrate', json({ file, box, white })),
	colorShotUrl: (file: string) => `/bridge/color/shot/${encodeURIComponent(file)}`,
	colorImageUrl: (name: 'reference.jpg' | 'patch.jpg', version: number) => `/bridge/color/${name}?v=${version}`,
	forgetCalibration: () => call('/calibration', { method: 'DELETE' }),
	saveSettings: (settings: { galleryUrl: string; uploadKey: string }) =>
		call('/settings', { ...json(settings), method: 'PUT' }),
	openProject: (name: string, create = false) => call<{ project: string }>('/projects', json({ name, create })),
	process: (body: {
		file: string
		quad: Quad
		title: string
		groupId: string
		material?: string
		widthCm?: number
		heightCm?: number
	}) =>
		call<LocalPainting>('/process', json(body)),
	addGroup: (name: string) => call<Group>('/groups', json({ name })),
	paintings: () => call<LocalPainting[]>('/paintings'),
	sync: () => call<{ synced: number; failed: { id: string; error: string }[] }>('/sync', { method: 'POST' }),
	paintingSource: (id: string) => call<{ file: string; camera: Camera; quad: Quad }>(`/paintings/${id}/source`),
	changePainting: (id: string, change: PaintingChange) => call<LocalPainting>(`/paintings/${id}`, { ...json(change), method: 'PUT' }),
	thumbUrl: ({ id, createdAt, updatedAt }: LocalPainting) => `/bridge/paintings/${id}/thumb.jpg?v=${updatedAt ?? createdAt}`,
	photoUrl: (file: string, painting?: string) => `/bridge/photo/${encodeURIComponent(file)}${painting ? `?painting=${painting}` : ''}`,
}
