import sharp from 'sharp'
import { webVariants, webVariantsVersion, type WebVariant } from '../shared/image-variants'
import { api, json } from './api'

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

// derive all web variants from the archive master, upload them, and record the config version
export async function publishWebVariants(paintingId: string, archive: Buffer) {
	const rendered = await renderWebVariants(archive)
	for (const name of Object.keys(rendered) as WebVariant[]) {
		await api(`/paintings/${paintingId}/images/${name}`, {
			method: 'PUT',
			body: new Uint8Array(rendered[name]),
			headers: { 'content-type': 'image/jpeg' },
		})
	}
	await api(`/paintings/${paintingId}/variants-version`, { method: 'PUT', ...json({ variants_version: webVariantsVersion }) })
}
