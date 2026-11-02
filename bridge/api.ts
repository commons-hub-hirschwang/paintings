// Admin API client for the bridge and scripts. Config in .env.local:
//   GALLERY_URL=http://localhost:5173   (or https://art.commons-hub.at)
//   ADMIN_USER=felix
//   ADMIN_PASSWORD=...
import { existsSync } from 'node:fs'

if (existsSync('.env.local')) process.loadEnvFile('.env.local')

export const galleryUrl = process.env.GALLERY_URL ?? 'http://localhost:5173'
const authorization = 'Basic ' + Buffer.from(`${process.env.ADMIN_USER}:${process.env.ADMIN_PASSWORD}`).toString('base64')

export async function api(path: string, init: RequestInit = {}) {
	const response = await fetch(`${galleryUrl}/api/admin${path}`, {
		...init,
		headers: { authorization, ...init.headers },
	})
	if (!response.ok) throw new Error(`${init.method ?? 'GET'} ${path}: ${response.status} ${await response.text()}`)
	return response
}

export const json = (body: unknown): RequestInit => ({
	body: JSON.stringify(body),
	headers: { 'content-type': 'application/json' },
})
