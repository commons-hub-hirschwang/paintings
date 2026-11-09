import { reactive } from 'vue'
import type { Painting } from '../shared/types'

// average color of each painting (by id), measured from whichever of its images loads first; light: dark text on it
export const ambient = reactive(new Map<string, { color: string; light: boolean }>())

const size = 16
const canvas = document.createElement('canvas')
canvas.width = canvas.height = size
const context = canvas.getContext('2d', { willReadFrequently: true })!
context.imageSmoothingQuality = 'high'

export function measureAmbient(id: string, img: HTMLImageElement) {
	if (ambient.has(id)) return
	context.clearRect(0, 0, size, size)
	context.drawImage(img, 0, 0, size, size)
	const data = context.getImageData(0, 0, size, size).data
	let r = 0
	let g = 0
	let b = 0
	for (let i = 0; i < data.length; i += 4) {
		r += data[i]!
		g += data[i + 1]!
		b += data[i + 2]!
	}
	const n = data.length / 4
	ambient.set(id, {
		color: `rgb(${Math.round(r / n)} ${Math.round(g / n)} ${Math.round(b / n)})`,
		light: (0.2126 * r + 0.7152 * g + 0.0722 * b) / n > 140,
	})
}

// 0.5 cm rounded off the real painting's corners (hides black rectification corners), as % of the image box per axis
const cornerCm = 0.5
export const cornerRadius = (p: Pick<Painting, 'width_cm' | 'height_cm'>) =>
	p.width_cm && p.height_cm ? `${(100 * cornerCm) / p.width_cm}% / ${(100 * cornerCm) / p.height_cm}%` : '0.1rem'
