import sharp from 'sharp'
import type { Quad } from '../shared/geometry'
import { archive } from '../shared/image-variants'

// Solve the 8 homography coefficients mapping the output rectangle onto the source quad.
function homography(width: number, height: number, quad: Quad) {
	const from = [
		[0, 0],
		[width, 0],
		[width, height],
		[0, height],
	] as const
	const rows: number[][] = []
	for (let i = 0; i < 4; i++) {
		const [x, y] = from[i]!
		const { x: u, y: v } = quad[i]!
		rows.push([x, y, 1, 0, 0, 0, -u * x, -u * y, u])
		rows.push([0, 0, 0, x, y, 1, -v * x, -v * y, v])
	}
	// Gaussian elimination with partial pivoting
	for (let col = 0; col < 8; col++) {
		let pivot = col
		for (let row = col + 1; row < 8; row++) if (Math.abs(rows[row]![col]!) > Math.abs(rows[pivot]![col]!)) pivot = row
		;[rows[col], rows[pivot]] = [rows[pivot]!, rows[col]!]
		const p = rows[col]!
		for (let row = 0; row < 8; row++) {
			if (row === col) continue
			const r = rows[row]!
			const factor = r[col]! / p[col]!
			for (let k = col; k < 9; k++) r[k]! -= factor * p[k]!
		}
	}
	// after elimination, row i holds only coefficient i
	return rows.map((r, i) => r[8]! / r[i]!)
}

// Rectify the quad of `file` into a width×height JPEG (the archive master).
export async function warpToRectangle(file: string, quad: Quad, width: number, height: number) {
	const { data: src, info } = await sharp(file).rotate().removeAlpha().raw().toBuffer({ resolveWithObject: true })
	const [a, b, c, d, e, f, g, h] = homography(width, height, quad) as [number, number, number, number, number, number, number, number]
	const out = Buffer.alloc(width * height * 3)
	const sw = info.width
	const sh = info.height
	for (let y = 0; y < height; y++) {
		for (let x = 0; x < width; x++) {
			const px = x + 0.5
			const py = y + 0.5
			const w = g * px + h * py + 1
			const u = Math.min(Math.max((a * px + b * py + c) / w - 0.5, 0), sw - 1.001)
			const v = Math.min(Math.max((d * px + e * py + f) / w - 0.5, 0), sh - 1.001)
			const x0 = Math.floor(u)
			const y0 = Math.floor(v)
			const fx = u - x0
			const fy = v - y0
			const i00 = (y0 * sw + x0) * 3
			const i10 = i00 + 3
			const i01 = i00 + sw * 3
			const i11 = i01 + 3
			const o = (y * width + x) * 3
			for (let ch = 0; ch < 3; ch++) {
				const top = src[i00 + ch]! * (1 - fx) + src[i10 + ch]! * fx
				const bottom = src[i01 + ch]! * (1 - fx) + src[i11 + ch]! * fx
				out[o + ch] = top * (1 - fy) + bottom * fy
			}
		}
	}
	return sharp(out, { raw: { width, height, channels: 3 } }).jpeg({ quality: archive.quality }).toBuffer()
}
