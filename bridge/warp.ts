import sharp from 'sharp'
import type { Point, Quad } from '../shared/geometry'
import { archive } from '../shared/image-variants'
import type { Lens } from './lens'

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

type Raw = { data: Buffer; width: number; height: number }
// photo → map(x, y, out) writes the source position of output pixel center (x, y) into out (pixel units)
type Mapping = (x: number, y: number, out: Float64Array) => void

export async function readOriented(file: string): Promise<Raw> {
	const { data, info } = await sharp(file).rotate().removeAlpha().raw().toBuffer({ resolveWithObject: true })
	return { data, width: info.width, height: info.height }
}

// bilinear resampling of `src` into a width×height RGB image
function remap(src: Raw, width: number, height: number, map: Mapping) {
	const out = Buffer.alloc(width * height * 3)
	const { data, width: sw, height: sh } = src
	const at = new Float64Array(2)
	for (let y = 0; y < height; y++) {
		for (let x = 0; x < width; x++) {
			map(x, y, at)
			const u = Math.min(Math.max(at[0]!, 0), sw - 1.001)
			const v = Math.min(Math.max(at[1]!, 0), sh - 1.001)
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
				const top = data[i00 + ch]! * (1 - fx) + data[i10 + ch]! * fx
				const bottom = data[i01 + ch]! * (1 - fx) + data[i11 + ch]! * fx
				out[o + ch] = top * (1 - fy) + bottom * fy
			}
		}
	}
	return sharp(out, { raw: { width, height, channels: 3 } })
}

// the lens-corrected photo (same size), shown in the corner editor; corners are picked in it
export async function correctLens(file: string, lens: Lens, quality = archive.quality) {
	const src = await readOriented(file)
	const { x: cx, y: cy } = lens.center
	return remap(src, src.width, src.height, (x, y, out) => {
		const k = lens.scaleAt(x, y)
		out[0] = cx + (x - cx) * k
		out[1] = cy + (y - cy) * k
	})
		.jpeg({ quality })
		.toBuffer()
}

// unit normal of the side from → to, pointing into the (clockwise) quad
function inward(from: Point, to: Point): Point {
	const length = Math.hypot(to.x - from.x, to.y - from.y)
	return { x: -(to.y - from.y) / length, y: (to.x - from.x) / length }
}

// Rectify the quad (in lens-corrected coordinates) of `file` into a width×height JPEG (the archive master).
// Samples the camera's photo directly (homography, then lens distortion): only one interpolation.
// bows (top, right, bottom, left; px, + = inwards, from bridge/detect.ts): the sides are slightly curved
// (canvas); a smooth displacement, zero at the corners, maps the curved sides onto the straight output edges.
export async function warpToRectangle(file: string, quad: Quad, width: number, height: number, lens: Lens | null, bows?: number[]) {
	const src = await readOriented(file)
	const [a, b, c, d, e, f, g, h] = homography(width, height, quad) as [number, number, number, number, number, number, number, number]
	const { x: cx, y: cy } = lens?.center ?? { x: 0, y: 0 }
	// per side: bow · inward normal
	const sides = [0, 1, 2, 3].map((k) => {
		const n = inward(quad[k]!, quad[(k + 1) % 4]!)
		const bow = bows?.[k] ?? 0
		return { x: n.x * bow, y: n.y * bow }
	})
	const [top, right, bottom, left] = sides as [Point, Point, Point, Point]
	const image = remap(src, width, height, (x, y, out) => {
		const px = x + 0.5
		const py = y + 0.5
		const w = g * px + h * py + 1
		// Coons-style blend of the 4 parabolic side displacements: exact on every side, zero at the corners
		const s = px / width
		const t = py / height
		const across = 4 * s * (1 - s)
		const down = 4 * t * (1 - t)
		const dx = across * ((1 - t) * top.x + t * bottom.x) + down * ((1 - s) * left.x + s * right.x)
		const dy = across * ((1 - t) * top.y + t * bottom.y) + down * ((1 - s) * left.y + s * right.y)
		// pixel centers: quad coordinates are continuous, pixel (i, j) covers [i, i+1)
		const u = (a * px + b * py + c) / w - 0.5 + dx
		const v = (d * px + e * py + f) / w - 0.5 + dy
		const k = lens ? lens.scaleAt(u, v) : 1
		out[0] = cx + (u - cx) * k
		out[1] = cy + (v - cy) * k
	})
	return image.jpeg({ quality: archive.quality }).toBuffer()
}
