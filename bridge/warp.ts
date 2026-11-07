import sharp from 'sharp'
import type { Camera, Point, Quad } from '../shared/geometry'
import { archive } from '../shared/image-variants'
import { remap } from './pool'

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

export async function readOriented(file: string): Promise<Raw> {
	const { data, info } = await sharp(file).rotate().removeAlpha().raw().toBuffer({ resolveWithObject: true })
	return { data, width: info.width, height: info.height }
}

const rgb = (data: Buffer, width: number, height: number) => sharp(data, { raw: { width, height, channels: 3 } })

// the lens-corrected photo (same size), shown in the corner editor; corners are picked in it
export async function correctLens(file: string, camera: Camera, quality = archive.quality) {
	const src = await readOriented(file)
	return rgb(await remap(src, src.width, src.height, { kind: 'lens', camera }), src.width, src.height).jpeg({ quality }).toBuffer()
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
// adjust: changes the photo's RGB pixels before resampling (the colour calibration's white balance).
export async function warpToRectangle(file: string, quad: Quad, width: number, height: number, camera: Camera, bows?: number[], adjust?: (data: Buffer) => unknown) {
	const src = await readOriented(file)
	adjust?.(src.data)
	// per side: bow · inward normal
	const sides = [0, 1, 2, 3].map((k) => {
		const n = inward(quad[k]!, quad[(k + 1) % 4]!)
		const bow = bows?.[k] ?? 0
		return { x: n.x * bow, y: n.y * bow }
	})
	const pixels = await remap(src, width, height, { kind: 'warp', camera, homography: homography(width, height, quad), sides, width, height })
	return rgb(pixels, width, height).jpeg({ quality: archive.quality }).toBuffer()
}
