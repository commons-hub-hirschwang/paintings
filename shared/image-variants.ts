// Image variants. The archive is the master (rectified, full resolution) and stays on the capture laptop; the gallery only
// gets the web variants derived from it, which the laptop can regenerate any time:
//   pnpm images:regen            (only paintings whose variants are outdated)
//   pnpm images:regen --force    (all)
// Changing anything below changes `webVariantsVersion`, which marks every painting as outdated.

export const archive = { quality: 90 } as const

export const webVariants = {
	detail: { maxSize: 2560, quality: 80 },
	normal: { maxSize: 1280, quality: 75 },
	thumb: { maxSize: 384, quality: 70 },
} as const

export type WebVariant = keyof typeof webVariants

export function isWebVariant(name: string): name is WebVariant {
	return Object.hasOwn(webVariants, name)
}

// FNV-1a over the config, so Worker and Node agree without crypto APIs
function hash(text: string): string {
	let h = 0x811c9dc5
	for (let i = 0; i < text.length; i++) {
		h ^= text.charCodeAt(i)
		h = Math.imul(h, 0x01000193)
	}
	return (h >>> 0).toString(16).padStart(8, '0')
}

export const webVariantsVersion = hash(JSON.stringify(webVariants))

export const imageKey = (paintingId: string, variant: WebVariant) => `paintings/${paintingId}/${variant}.jpg`
