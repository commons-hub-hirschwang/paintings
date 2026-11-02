// Client for the local capture bridge (pnpm bridge), reached via the Vite dev proxy.
import type { Calibration, Quad } from '../shared/geometry'

export type BridgeStatus = { cameras: string[]; calibration: Calibration | null; galleryUrl: string }
export type Processed = { id: string; widthCm: number; heightCm: number; width: number; height: number }

async function call<T>(path: string, init?: RequestInit): Promise<T> {
	const response = await fetch(`/bridge${path}`, init).catch(() => {
		throw new Error('bridge not reachable — is `pnpm bridge` running?')
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
	capture: () => call<{ file: string }>('/capture', { method: 'POST' }),
	upload: (file: File) => call<{ file: string }>('/upload', { method: 'POST', body: file }),
	forgetCalibration: () => call('/calibration', { method: 'DELETE' }),
	process: (body: { file: string; quad: Quad; title: string; widthCm?: number; heightCm?: number }) =>
		call<Processed>('/process', json(body)),
	rawUrl: (file: string) => `/bridge/raw/${encodeURIComponent(file)}`,
}
