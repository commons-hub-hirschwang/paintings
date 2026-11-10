import { onBeforeUnmount, reactive, watchEffect } from 'vue'

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

// the color stored with the painting ("#rrggbb"): there before the image has loaded
const fromHex = (hex: string) => {
	const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16)) as [number, number, number]
	return { color: hex, light: 0.2126 * r + 0.7152 * g + 0.0722 * b > 140 }
}

// a wall in a painting's average color (stored, else measured in the browser): page colors (--bg, --fg, --muted) for an
// element or the whole page, text in contrast to it; nothing while the painting is not measured yet
export function wallColors(id: string, stored?: string | null): Record<string, string> | undefined {
	const a = stored ? fromHex(stored) : ambient.get(id)
	return (
		a && {
			'--bg': a.color,
			'--fg': a.light ? '#222' : '#eee',
			'--muted': a.light ? 'rgb(0 0 0 / 0.55)' : 'rgb(255 255 255 / 0.6)',
		}
	)
}

// the whole page in the colors of a painting's wall while the view shows it (nothing: the default page colors)
export function usePageColors(colors: () => Record<string, string> | null | undefined) {
	const style = document.documentElement.style
	const reset = () => ['--bg', '--fg', '--muted'].forEach((name) => style.removeProperty(name))
	watchEffect(() => {
		const current = colors()
		if (!current) return reset()
		for (const [name, value] of Object.entries(current)) style.setProperty(name, value)
	})
	onBeforeUnmount(reset)
}

// 0.5 cm rounded off the real painting's corners (hides black rectification corners), as % of the image box per axis
const cornerCm = 0.5
export const cornerRadius = (widthCm: number | null | undefined, heightCm: number | null | undefined) =>
	widthCm && heightCm ? `${(100 * cornerCm) / widthCm}% / ${(100 * cornerCm) / heightCm}%` : '0.1rem'
