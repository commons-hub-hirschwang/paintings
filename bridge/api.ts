// Capture API client for the bridge and scripts. Settings (gallery URL + upload key) are edited in the capture
// UI and stored in captures/settings.json; GALLERY_URL / UPLOAD_KEY in .env.local are the fallback.
import { existsSync, readFileSync } from 'node:fs'
import { writeFile } from 'node:fs/promises'
import { projectPath } from './project'

if (existsSync('.env.local')) process.loadEnvFile('.env.local')

export type Settings = { galleryUrl: string; uploadKey: string }
// per project: each project can sync to its own gallery
const settingsFile = () => projectPath('settings.json')

// any URL on the site works (e.g. …/admin): only the origin is used
const origin = (url: string) => {
	try {
		return new URL(url).origin
	} catch {
		return url.replace(/\/+$/, '')
	}
}

export function getSettings(): Settings {
	const stored: Partial<Settings> = existsSync(settingsFile()) ? JSON.parse(readFileSync(settingsFile(), 'utf8')) : {}
	return {
		galleryUrl: origin(stored.galleryUrl ?? process.env.GALLERY_URL ?? 'http://localhost:5173'),
		uploadKey: stored.uploadKey ?? process.env.UPLOAD_KEY ?? '',
	}
}

export async function saveSettings(settings: Partial<Settings>) {
	await writeFile(settingsFile(), JSON.stringify({ ...getSettings(), ...settings }, null, '\t'))
}

export async function api(path: string, init: RequestInit = {}) {
	const { galleryUrl, uploadKey } = getSettings()
	const response = await fetch(`${galleryUrl}/api/capture${path}`, {
		...init,
		headers: { authorization: `Bearer ${uploadKey}`, ...init.headers },
	})
	if (!response.ok) throw new Error(`${init.method ?? 'GET'} ${path}: ${response.status} ${await response.text()}`)
	return response
}

export const json = (body: unknown): RequestInit => ({
	body: JSON.stringify(body),
	headers: { 'content-type': 'application/json' },
})

// checks URL + key; returns the key's name
export async function checkConnection(): Promise<{ ok: true; key: string } | { ok: false; error: string }> {
	try {
		const { key } = (await (await api('/me')).json()) as { key: string }
		return { ok: true, key }
	} catch (error) {
		return { ok: false, error: (error as Error).message }
	}
}
