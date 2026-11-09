import sharp from 'sharp'
import { webVariants, webVariantsVersion, type WebVariant } from '../shared/image-variants'
import { api, json } from './api'

// average colour of an image, "#rrggbb": the wall the painting hangs on in the gallery
export async function averageColor(jpeg: Buffer) {
	const { channels } = await sharp(jpeg).stats()
	return `#${channels.slice(0, 3).map((c) => Math.round(c.mean).toString(16).padStart(2, '0')).join('')}`
}

export async function renderWebVariants(archive: Buffer) {
	const rendered = {} as Record<WebVariant, Buffer>
	for (const name of Object.keys(webVariants) as WebVariant[]) {
		const { maxSize, quality } = webVariants[name]
		rendered[name] = await sharp(archive)
			.resize({ width: maxSize, height: maxSize, fit: 'inside', withoutEnlargement: true })
			.jpeg({ quality, mozjpeg: true })
			.toBuffer()
	}
	return rendered
}

// derive all web variants from the archive master, upload them, and record the config version + publish time (image
// URLs carry this and are cached forever, so a changed painting needs a new one) and the painting's average colour
export async function publishWebVariants(paintingId: string, archive: Buffer, step: (name: string) => void = () => {}) {
	step('rendering')
	const rendered = await renderWebVariants(archive)
	for (const name of Object.keys(rendered) as WebVariant[]) {
		step(`uploading ${name}`)
		await api(`/paintings/${paintingId}/images/${name}`, {
			method: 'PUT',
			body: new Uint8Array(rendered[name]),
			headers: { 'content-type': 'image/jpeg' },
		})
	}
	await api(`/paintings/${paintingId}/variants-version`, { method: 'PUT', ...json({ variants_version: `${webVariantsVersion}-${Date.now()}`, color: await averageColor(rendered.thumb) }) })
}
