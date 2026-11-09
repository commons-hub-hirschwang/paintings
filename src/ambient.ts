import { reactive } from 'vue'

// average color of each painting (by id), measured from whichever of its images loads first
export const ambient = reactive(new Map<string, string>())

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
	ambient.set(id, `rgb(${Math.round(r / n)} ${Math.round(g / n)} ${Math.round(b / n)})`)
}
