// Automatic painting corners in the lens-corrected photo: find the 4 edges of the canvas, fit curves to them
// with sub-pixel precision and intersect them. Corners from fitted edges are more precise than clicked ones
// and don't care about rounded or occluded corners.
//  1. coarse: Hough lines on a small copy; the best quad of 2 roughly horizontal + 2 roughly vertical lines
//     (edge support along all 4 sides, then size). A rough quad (previous painting, manual "snap") is a candidate too.
//  2. refine at full resolution: along each side, the strongest step (consistent sign) across the side,
//     sub-pixel peak, robust quadratic fit (RANSAC + least squares): straight or slightly bowed edges.
//     Paint strokes and background become outliers. Corners: where neighbouring curves meet.
import sharp from 'sharp'
import { reconstruct, type Camera, type Point, type Quad } from '../shared/geometry'

type Grey = { data: Float32Array; width: number; height: number }
type Line = { n: Point; rho: number } // n·p = rho, |n| = 1 (coarse search)

// bowPx: sagitta of the side relative to the straight line between its corners, + = bowed inwards
export type Side = { inliers: number; bowPx: number; contrast: number }
export type Detection = { quad: Quad; sides: Side[] }

const COARSE_SIZE = 1000 // long side of the Hough image
const MIN_INLIERS = 0.6 // share of edge samples on the fitted curve, per side, for a trusted detection
const MAX_ANGLE_ERROR = 1 // ° off square in 3D (shared/geometry.ts reconstruct), for a trusted detection

async function grey(file: string | Buffer, longSide?: number, blur = 1.2): Promise<Grey> {
	let image = sharp(file).rotate()
	if (longSide) image = image.resize({ width: longSide, height: longSide, fit: 'inside' })
	const { data, info } = await image.greyscale().blur(blur).raw().toBuffer({ resolveWithObject: true })
	return { data: Float32Array.from(data), width: info.width, height: info.height }
}

function sample({ data, width, height }: Grey, x: number, y: number) {
	if (x < 0 || y < 0 || x > width - 1.001 || y > height - 1.001) return NaN
	const x0 = Math.floor(x)
	const y0 = Math.floor(y)
	const fx = x - x0
	const fy = y - y0
	const i = y0 * width + x0
	return (data[i]! * (1 - fx) + data[i + 1]! * fx) * (1 - fy) + (data[i + width]! * (1 - fx) + data[i + width + 1]! * fx) * fy
}

const intersect = (a: Line, b: Line): Point => {
	const det = a.n.x * b.n.y - a.n.y * b.n.x
	return { x: (a.rho * b.n.y - b.rho * a.n.y) / det, y: (a.n.x * b.rho - b.n.x * a.rho) / det }
}
// top, right, bottom, left lines → corners TL, TR, BR, BL
const corners = ([top, right, bottom, left]: Line[]): Quad =>
	[intersect(top!, left!), intersect(top!, right!), intersect(bottom!, right!), intersect(bottom!, left!)] as Quad

// sides of a quad as (from, to) in the order top, right, bottom, left
const sidesOf = ([tl, tr, br, bl]: Quad): [Point, Point][] => [
	[tl, tr],
	[tr, br],
	[br, bl],
	[bl, tl],
]

// unit normal of a side pointing into the quad (quad is clockwise in image coordinates)
function inward(from: Point, to: Point): Point {
	const length = Math.hypot(to.x - from.x, to.y - from.y)
	return { x: -(to.y - from.y) / length, y: (to.x - from.x) / length }
}

// ---------- coarse: Hough ----------

function houghLines(image: Grey) {
	const { width, height } = image
	const ANGLES = 360 // 0.5° bins over 180°
	const diagonal = Math.hypot(width, height)
	const RHO_BINS = Math.ceil(diagonal) * 2
	const votes = new Float32Array(ANGLES * RHO_BINS)
	const magnitudes: number[] = []
	const gradients: [number, number, number, number][] = []
	for (let y = 1; y < height - 1; y++) {
		for (let x = 1; x < width - 1; x++) {
			const i = y * width + x
			const d = image.data
			const gx = d[i + 1 - width]! + 2 * d[i + 1]! + d[i + 1 + width]! - d[i - 1 - width]! - 2 * d[i - 1]! - d[i - 1 + width]!
			const gy = d[i + width - 1]! + 2 * d[i + width]! + d[i + width + 1]! - d[i - width - 1]! - 2 * d[i - width]! - d[i - width + 1]!
			const magnitude = Math.hypot(gx, gy)
			if (magnitude > 40) gradients.push([x, y, gx, gy])
			magnitudes.push(magnitude)
		}
	}
	// strong edges only (top 8 %, but at least a clear step)
	magnitudes.sort((a, b) => a - b)
	const threshold = Math.max(60, magnitudes[Math.floor(magnitudes.length * 0.92)]!)
	for (const [x, y, gx, gy] of gradients) {
		const magnitude = Math.hypot(gx, gy)
		if (magnitude < threshold) continue
		let angle = Math.atan2(gy, gx)
		if (angle < 0) angle += Math.PI
		// near-horizontal or near-vertical edges only (±25°)
		const deg = (angle * 180) / Math.PI
		if (Math.min(deg, 180 - deg, Math.abs(deg - 90)) > 25) continue
		const center = Math.round((angle / Math.PI) * ANGLES)
		for (let k = center - 2; k <= center + 2; k++) {
			const bin = ((k % ANGLES) + ANGLES) % ANGLES
			const theta = (bin / ANGLES) * Math.PI
			const rho = x * Math.cos(theta) + y * Math.sin(theta)
			votes[bin * RHO_BINS + Math.round(rho + diagonal)]! += magnitude
		}
	}
	// peaks: local maxima, strongest first, separated by ≥ 2 % of the image
	const peaks: { line: Line; votes: number }[] = []
	const order = [...votes.keys()].filter((i) => votes[i]! > 0).sort((a, b) => votes[b]! - votes[a]!)
	const minSeparation = 0.02 * Math.max(width, height)
	for (const i of order) {
		if (peaks.length >= 40) break
		const theta = (Math.floor(i / RHO_BINS) / ANGLES) * Math.PI
		const rho = (i % RHO_BINS) - diagonal
		const line = { n: { x: Math.cos(theta), y: Math.sin(theta) }, rho }
		const close = peaks.some(({ line: other }) => {
			const dot = line.n.x * other.n.x + line.n.y * other.n.y
			return Math.abs(Math.abs(dot) - 1) < 0.002 && Math.abs(Math.abs(rho) - Math.abs(other.rho)) < minSeparation
		})
		if (!close) peaks.push({ line, votes: votes[i]! })
	}
	return peaks.map((p) => p.line)
}

// share of points along the side with a clear step across it, all of the same sign (canvas vs background)
function support(image: Grey, from: Point, to: Point, samples = 40, offset = 2) {
	const n = inward(from, to)
	let positive = 0
	let negative = 0
	for (let i = 0; i < samples; i++) {
		const t = 0.05 + (0.9 * i) / (samples - 1)
		const x = from.x + (to.x - from.x) * t
		const y = from.y + (to.y - from.y) * t
		const step = sample(image, x + n.x * offset, y + n.y * offset) - sample(image, x - n.x * offset, y - n.y * offset)
		if (step > 12) positive++
		else if (step < -12) negative++
	}
	return Math.max(positive, negative) / samples
}

function inside({ x, y }: Point, image: Grey) {
	return x >= 0 && y >= 0 && x <= image.width && y <= image.height
}

function coarseQuad(image: Grey): Quad | null {
	const lines = houghLines(image)
	// image y axis points down: "horizontal" lines have a vertical normal
	const horizontal = lines.filter((l) => Math.abs(l.n.y) > 0.9).slice(0, 12)
	const vertical = lines.filter((l) => Math.abs(l.n.x) > 0.9).slice(0, 12)
	// y of a horizontal line at the image center column, x of a vertical line at the center row
	const center = { x: image.width / 2, y: image.height / 2 }
	const position = (l: Line) => (Math.abs(l.n.y) > 0.9 ? (l.rho - l.n.x * center.x) / l.n.y : (l.rho - l.n.y * center.y) / l.n.x)
	let best: { quad: Quad; score: number } | null = null
	for (const [i, a] of horizontal.entries())
		for (const b of horizontal.slice(i + 1))
			for (const [j, c] of vertical.entries())
				for (const d of vertical.slice(j + 1)) {
					const [top, bottom] = position(a) < position(b) ? [a, b] : [b, a]
					const [left, right] = position(c) < position(d) ? [c, d] : [d, c]
					const quad = corners([top, right, bottom, left])
					if (!quad.every((p) => inside(p, image))) continue
					const area = polygonArea(quad) / (image.width * image.height)
					if (area < 0.05) continue
					const supports = sidesOf(quad).map(([from, to]) => support(image, from, to))
					const score = Math.min(...supports) * 0.7 + (supports.reduce((s, v) => s + v, 0) / 4) * 0.3 + 0.1 * area
					if (!best || score > best.score) best = { quad, score }
				}
	return best?.quad ?? null
}

function polygonArea(quad: Quad) {
	let area = 0
	for (let i = 0; i < 4; i++) {
		const a = quad[i]!
		const b = quad[(i + 1) % 4]!
		area += a.x * b.y - b.x * a.y
	}
	return Math.abs(area) / 2
}

// ---------- refine: sub-pixel edges + robust line fit ----------

// ---------- refine: sub-pixel edge points, robust quadratic curve per side ----------
// A side is the curve P(t) = from + (to − from)·t + n·offset(t), offset(t) = α + β·t + γ·4t(1 − t), with n the
// inward normal of the rough side: a straight edge has γ = 0, a bowed one (canvas, lens remainder) doesn't.

type Coefficients = [number, number, number]
type Curve = { from: Point; to: Point; n: Point; coefficients: Coefficients }

const offsetAt = ([alpha, beta, gamma]: Coefficients, t: number) => alpha + beta * t + gamma * 4 * t * (1 - t)
const pointAt = ({ from, to, n, coefficients }: Curve, t: number): Point => {
	const o = offsetAt(coefficients, t)
	return { x: from.x + (to.x - from.x) * t + n.x * o, y: from.y + (to.y - from.y) * t + n.y * o }
}

// least squares offset(t) through (t, o) samples
function fitOffsets(samples: { t: number; o: number }[]): Coefficients | null {
	const m = [0, 0, 0, 0, 0, 0, 0, 0, 0]
	const v = [0, 0, 0]
	for (const { t, o } of samples) {
		const basis = [1, t, 4 * t * (1 - t)]
		for (let i = 0; i < 3; i++) {
			v[i]! += basis[i]! * o
			for (let j = 0; j < 3; j++) m[i * 3 + j]! += basis[i]! * basis[j]!
		}
	}
	return solve3(m, v)
}

function solve3(m: number[], v: number[]): Coefficients | null {
	const det3 = (a: number[]) =>
		a[0]! * (a[4]! * a[8]! - a[5]! * a[7]!) - a[1]! * (a[3]! * a[8]! - a[5]! * a[6]!) + a[2]! * (a[3]! * a[7]! - a[4]! * a[6]!)
	const det = det3(m)
	if (Math.abs(det) < 1e-12) return null
	return [0, 1, 2].map((col) => det3(m.map((value, i) => (i % 3 === col ? v[Math.floor(i / 3)]! : value))) / det) as Coefficients
}

type Peak = { t: number; o: number; strength: number }

function refineSide(image: Grey, from: Point, to: Point, range: number, prior: Coefficients = [0, 0, 0]) {
	const SAMPLES = 80
	const n = inward(from, to)
	// per sample: best positive and best negative step across the side
	const found: { positive: Peak | null; negative: Peak | null }[] = []
	for (let i = 0; i < SAMPLES; i++) {
		const t = 0.04 + (0.92 * i) / (SAMPLES - 1)
		const center = offsetAt(prior, t)
		const base = { x: from.x + (to.x - from.x) * t + n.x * center, y: from.y + (to.y - from.y) * t + n.y * center }
		const profile: number[] = []
		for (let o = -range - 3; o <= range + 3; o++) profile.push(sample(image, base.x + n.x * o, base.y + n.y * o))
		const peaks: { positive: Peak | null; negative: Peak | null } = { positive: null, negative: null }
		const steps: number[] = [] // steps[k]: derivative at offset k − range
		for (let k = 3; k < profile.length - 3; k++) steps.push((profile[k + 2]! - profile[k - 2]!) / 4)
		for (let k = 1; k < steps.length - 1; k++) {
			const s = steps[k]!
			if (!Number.isFinite(s) || Math.abs(s) < 2) continue
			if (Math.abs(s) < Math.abs(steps[k - 1]!) || Math.abs(s) < Math.abs(steps[k + 1]!)) continue
			// sub-pixel: parabola through the neighbouring steps
			const [l, r] = [steps[k - 1]!, steps[k + 1]!]
			const denominator = l - 2 * s + r
			const shift = denominator !== 0 ? Math.max(-0.5, Math.min(0.5, (0.5 * (l - r)) / denominator)) : 0
			const peak = { t, o: center + k - range + shift, strength: Math.abs(s) }
			const key = s > 0 ? 'positive' : 'negative'
			if (!peaks[key] || peak.strength > peaks[key].strength) peaks[key] = peak
		}
		found.push(peaks)
	}
	// the sign of the canvas edge: the one with more strength along the whole side
	const total = (key: 'positive' | 'negative') => found.reduce((s, f) => s + (f[key]?.strength ?? 0), 0)
	const key = total('positive') >= total('negative') ? 'positive' : 'negative'
	const peaks = found.map((f) => f[key]).filter((p): p is Peak => !!p)
	if (peaks.length < 6) return null

	// RANSAC: curve through 3 random peaks (start, middle, end) with the most peaks within 1.5 px
	const TOLERANCE = 1.5
	const within = (coefficients: Coefficients) => peaks.filter((p) => Math.abs(offsetAt(coefficients, p.t) - p.o) < TOLERANCE)
	const pick = (lo: number, hi: number) => {
		const candidates = peaks.filter((p) => p.t >= lo && p.t < hi)
		return candidates[Math.floor(Math.random() * candidates.length)]
	}
	let best: Peak[] = []
	for (let k = 0; k < 400; k++) {
		const chosen = [pick(0, 0.33), pick(0.33, 0.67), pick(0.67, 1)]
		if (chosen.some((p) => !p)) break
		const coefficients = fitOffsets(chosen as Peak[])
		if (!coefficients) continue
		const inliers = within(coefficients)
		if (inliers.length > best.length) best = inliers
	}
	if (best.length < 6) return null
	let coefficients = fitOffsets(best)!
	for (let k = 0; k < 2; k++) {
		best = within(coefficients)
		coefficients = fitOffsets(best) ?? coefficients
	}
	return {
		curve: { from, to, n, coefficients },
		inliers: best.length / SAMPLES,
		contrast: best.reduce((s, p) => s + p.strength, 0) / best.length,
	}
}

// where the end of curve a meets the start of curve b (Newton on a(s) = b(u))
function meet(a: Curve, b: Curve) {
	let s = 1
	let u = 0
	const h = 1e-4
	for (let k = 0; k < 20; k++) {
		const pa = pointAt(a, s)
		const pb = pointAt(b, u)
		const fx = pa.x - pb.x
		const fy = pa.y - pb.y
		if (Math.hypot(fx, fy) < 1e-6) break
		const das = pointAt(a, s + h)
		const dbu = pointAt(b, u + h)
		// Jacobian columns: d/ds of (a − b), d/du of (a − b)
		const j11 = (das.x - pa.x) / h
		const j21 = (das.y - pa.y) / h
		const j12 = -(dbu.x - pb.x) / h
		const j22 = -(dbu.y - pb.y) / h
		const det = j11 * j22 - j12 * j21
		if (Math.abs(det) < 1e-12) break
		s -= (j22 * fx - j12 * fy) / det
		u -= (-j21 * fx + j11 * fy) / det
	}
	return { s, u, point: pointAt(a, s) }
}

function refine(image: Grey, quad: Quad, range: number): Detection | null {
	const sides = sidesOf(quad)
	let results = sides.map(([from, to]) => refineSide(image, from, to, range))
	if (results.some((r) => !r)) return null
	// second pass with profiles centered on the found curves: short search, no stray edges
	results = sides.map(([from, to], i) => refineSide(image, from, to, 6, results[i]!.curve.coefficients) ?? results[i]!)
	const curves = results.map((r) => r!.curve)
	// corner k: end of side k − 1 meets start of side k
	const joints = curves.map((curve, k) => meet(curves[(k + 3) % 4]!, curve))
	const quadOut = joints.map((j) => j.point) as Quad
	return {
		quad: quadOut,
		sides: curves.map((curve, k) => {
			const start = joints[k]!.u
			const end = joints[(k + 1) % 4]!.s
			// sagitta: curve middle vs the chord between the corners, + = towards the inside
			const a = pointAt(curve, start)
			const b = pointAt(curve, end)
			const middle = pointAt(curve, (start + end) / 2)
			const n = inward(a, b)
			const bowPx = (middle.x - (a.x + b.x) / 2) * n.x + (middle.y - (a.y + b.y) / 2) * n.y
			return { inliers: results[k]!.inliers, contrast: results[k]!.contrast, bowPx }
		}),
	}
}

const scale = (quad: Quad, factor: number) => quad.map((p) => ({ x: p.x * factor, y: p.y * factor })) as Quad

const quality = (d: Detection) => d.sides.reduce((s, side) => s + side.inliers, 0) / 4

// good enough to skip the human: clear edges on all sides, square corners in 3D, little bow
export function trusted(d: Detection, camera: Camera) {
	const shape = reconstruct(d.quad, camera)
	const longSide = Math.max(camera.width, camera.height)
	return (
		d.sides.every((side) => side.inliers >= MIN_INLIERS && Math.abs(side.bowPx) < longSide * 0.005) &&
		(!shape || shape.angleErrorDeg < MAX_ANGLE_ERROR)
	)
}

// corners of the painting in `file` (the lens-corrected photo); `hint`: rough corners (previous painting,
// or placed by hand), used as an extra candidate, or as the only start with `onlyHint` (snap)
export async function detectCorners(file: string | Buffer, hint?: Quad | null, onlyHint = false): Promise<Detection | null> {
	const full = await grey(file)
	const starts: { quad: Quad; range: number }[] = []
	const longSide = Math.max(full.width, full.height)
	if (hint) starts.push({ quad: hint, range: Math.round(longSide * 0.04) })
	if (!onlyHint) {
		const small = await grey(file, COARSE_SIZE, 1)
		const factor = full.width / small.width
		const coarse = coarseQuad(small)
		if (coarse) starts.push({ quad: scale(coarse, factor), range: Math.ceil(factor * 3) + 4 })
	}
	let best: Detection | null = null
	for (const { quad, range } of starts) {
		const detection = refine(full, quad, range)
		if (detection && (!best || quality(detection) > quality(best))) best = detection
	}
	return best && upright(best)
}

// corners (and sides) in the photo's orientation, starting top left: a hint may come in the painting's
// orientation (rotated view in the capture UI), which the UI applies again
function upright(detection: Detection): Detection {
	const sums = detection.quad.map((p) => p.x + p.y)
	const first = sums.indexOf(Math.min(...sums))
	const turn = <T>(items: T[]) => items.map((_, i) => items[(i + first) % 4]!)
	return { quad: turn(detection.quad) as Quad, sides: turn(detection.sides) }
}
