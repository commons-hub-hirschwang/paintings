// Bilinear resampling of a photo, row by row. Runs in the worker threads of bridge/pool.ts, so a mapping is plain data
// (a function can't be sent to a thread) and this file stays free of anything heavy to load.
import type { Camera, Point } from '../shared/geometry'
import { lensOf } from './lens.ts'

// where an output pixel comes from
export type Mapping =
	// the lens-corrected photo: output pixels are corrected photo pixels
	| { kind: 'lens'; camera: Camera }
	// the rectified painting: homography (8 coefficients, output rectangle → quad), displaced by the curved sides
	// (top, right, bottom, left: bow · inward normal), then the lens distortion if the photo has a profile
	| { kind: 'warp'; camera: Camera; homography: number[]; sides: Point[]; width: number; height: number }

export type RemapRows = {
	src: SharedArrayBuffer
	sourceWidth: number
	sourceHeight: number
	out: SharedArrayBuffer
	width: number
	height: number
	fromRow: number
	toRow: number
	mapping: Mapping
}

// map(x, y, out) writes the source position of output pixel (x, y) into out (pixel units)
type Map = (x: number, y: number, out: Float64Array) => void

function mapOf(mapping: Mapping): Map {
	const lens = lensOf(mapping.camera)
	const { x: cx, y: cy } = lens?.center ?? { x: 0, y: 0 }
	if (mapping.kind === 'lens') {
		if (!lens) throw new Error('no lens profile')
		return (x, y, out) => {
			const k = lens.scaleAt(x, y)
			out[0] = cx + (x - cx) * k
			out[1] = cy + (y - cy) * k
		}
	}
	const { width, height } = mapping
	const [a, b, c, d, e, f, g, h] = mapping.homography as [number, number, number, number, number, number, number, number]
	const [top, right, bottom, left] = mapping.sides as [Point, Point, Point, Point]
	return (x, y, out) => {
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
	}
}

export function remapRows({ src, sourceWidth: sw, sourceHeight: sh, out: target, width, fromRow, toRow, mapping }: RemapRows) {
	const data = new Uint8Array(src)
	const out = new Uint8Array(target)
	const map = mapOf(mapping)
	const at = new Float64Array(2)
	for (let y = fromRow; y < toRow; y++) {
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
}
