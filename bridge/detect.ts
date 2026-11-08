// Automatic painting corners in the lens-corrected photo: find the 4 edges of the canvas, fit curves to them
// with sub-pixel precision and intersect them. Corners from fitted edges are more precise than clicked ones
// and don't care about rounded or occluded corners.
//  1. candidates: Hough lines on a small copy, from the strong edges and from weaker ones too (a dark canvas on the
//     dark background). Every quad of 2 roughly horizontal + 2 roughly vertical lines around the photo's centre, ranked
//     by edge support; the best CANDIDATES are refined, and a rough quad (previous painting) too.
//  2. refine at full resolution: along each side, the strongest steps across it of either sign (what's behind the
//     canvas changes: dark background, wood), sub-pixel peak, robust quadratic fit (RANSAC + least squares): only
//     steps on one straight or slightly bowed curve count. Paint strokes and background become outliers.
//     Corners: where neighbouring curves meet.
//  3. pick the refined quad whose sides have a step along their whole length, the parts next to the corners counting
//     most: a side that runs on past the canvas (along the easel) has none there.
// "Snap" (corners placed by hand) refines only those corners, searching near them.
import sharp from 'sharp'
import { MAX_BOW, reconstruct, type Camera, type Point, type Quad } from '../shared/geometry'

type Grey = { data: Float32Array; width: number; height: number }
type Line = { n: Point; rho: number } // n·p = rho, |n| = 1 (coarse search)

// bowPx: sagitta of the side relative to the straight line between its corners, + = bowed inwards
export type Side = { inliers: number; bowPx: number; contrast: number }
export type Detection = { quad: Quad; sides: Side[] }

const COARSE_SIZE = 1000 // long side of the Hough image
const CANDIDATES = 25 // coarse quads refined at full resolution
const MIN_INLIERS = 0.6 // share of edge samples on the fitted curve, per side, for a trusted detection
const MAX_ANGLE_ERROR = 1 // ° off square in 3D (shared/geometry.ts reconstruct), for a trusted detection

async function grey(file: string, longSide?: number, blur = 1.2): Promise<Grey> {
	let image = sharp(file).rotate()
	if (longSide) image = image.resize({ width: longSide, height: longSide, fit: 'inside' })
	const { data, info } = await image.greyscale().blur(blur).raw().toBuffer({ resolveWithObject: true })
	return { data: new Float32Array(data), width: info.width, height: info.height }
}

// The last photos' full-size grey images stay in memory: detection and the curves work on the same one, curves are
// measured again after every corner change, and a painting rendered in the background needs its own photo's.
const KEPT_PHOTOS = 3
const kept = new Map<string, Promise<Grey>>()
function fullGrey(file: string) {
	const image = kept.get(file) ?? grey(file)
	kept.delete(file)
	kept.set(file, image)
	image.catch(() => kept.delete(file))
	if (kept.size > KEPT_PHOTOS) kept.delete(kept.keys().next().value!)
	return image
}

// RANSAC's random picks, seeded on every detection: the same photo always gives the same corners
let seed = 0
const random = () => {
	seed = (seed + 0x6d2b79f5) >>> 0
	let t = seed
	t = Math.imul(t ^ (t >>> 15), t | 1)
	t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
	return ((t ^ (t >>> 14)) >>> 0) / 4294967296
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

// inside a clockwise quad (image coordinates)
const contains = (quad: Quad, p: Point) =>
	quad.every((a, i) => {
		const b = quad[(i + 1) % 4]!
		return (b.x - a.x) * (p.y - a.y) - (b.y - a.y) * (p.x - a.x) > 0
	})

const largestDistance = (a: Quad, b: Quad) => Math.max(...a.map((p, k) => Math.hypot(p.x - b[k]!.x, p.y - b[k]!.y)))

// ---------- coarse: Hough ----------

// Lines from the edges above each share of the gradients: 0.92 = the strong edges, 0.7 = weaker ones too (a dark
// canvas on the dark background next to a busy painting stays below the first)
const EDGE_SHARES = [0.92, 0.7]
const LINES_PER_DIRECTION = 12

function houghLines(image: Grey, share: number, gradients: [number, number, number, number][], magnitudes: Float64Array) {
	const { width, height } = image
	const ANGLES = 360 // 0.5° bins over 180°
	const diagonal = Math.hypot(width, height)
	const RHO_BINS = Math.ceil(diagonal) * 2
	const votes = new Float32Array(ANGLES * RHO_BINS)
	// edges above the share, but at least a clear step
	const threshold = Math.max(60, magnitudes[Math.floor(magnitudes.length * share)]!)
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
	const peaks: Line[] = []
	const order: number[] = []
	for (let i = 0; i < votes.length; i++) if (votes[i]! > 0) order.push(i)
	order.sort((a, b) => votes[b]! - votes[a]!)
	const minSeparation = 0.02 * Math.max(width, height)
	for (const i of order) {
		if (peaks.length >= LINES_PER_DIRECTION * 4) break
		const theta = (Math.floor(i / RHO_BINS) / ANGLES) * Math.PI
		const rho = (i % RHO_BINS) - diagonal
		const line = { n: { x: Math.cos(theta), y: Math.sin(theta) }, rho }
		const close = peaks.some((other) => {
			const dot = line.n.x * other.n.x + line.n.y * other.n.y
			return Math.abs(Math.abs(dot) - 1) < 0.002 && Math.abs(Math.abs(rho) - Math.abs(other.rho)) < minSeparation
		})
		if (!close) peaks.push(line)
	}
	return peaks
}

// the strongest roughly horizontal and roughly vertical lines, from strong and from weaker edges
function lines(image: Grey) {
	const { width, height } = image
	const magnitudes = new Float64Array((width - 2) * (height - 2))
	let measuredPixels = 0
	const gradients: [number, number, number, number][] = []
	for (let y = 1; y < height - 1; y++) {
		for (let x = 1; x < width - 1; x++) {
			const i = y * width + x
			const d = image.data
			const gx = d[i + 1 - width]! + 2 * d[i + 1]! + d[i + 1 + width]! - d[i - 1 - width]! - 2 * d[i - 1]! - d[i - 1 + width]!
			const gy = d[i + width - 1]! + 2 * d[i + width]! + d[i + width + 1]! - d[i - width - 1]! - 2 * d[i - width]! - d[i - width + 1]!
			const magnitude = Math.hypot(gx, gy)
			if (magnitude > 40) gradients.push([x, y, gx, gy])
			magnitudes[measuredPixels++] = magnitude
		}
	}
	magnitudes.sort()
	const horizontal: Line[] = []
	const vertical: Line[] = []
	const same = (a: Line, b: Line) => Math.abs(a.n.x * b.n.x + a.n.y * b.n.y) > 0.9999 && Math.abs(Math.abs(a.rho) - Math.abs(b.rho)) < 3
	for (const share of EDGE_SHARES) {
		const found = houghLines(image, share, gradients, magnitudes)
		// image y axis points down: "horizontal" lines have a vertical normal
		for (const line of found.filter((l) => Math.abs(l.n.y) > 0.9).slice(0, LINES_PER_DIRECTION))
			if (!horizontal.some((other) => same(other, line))) horizontal.push(line)
		for (const line of found.filter((l) => Math.abs(l.n.x) > 0.9).slice(0, LINES_PER_DIRECTION))
			if (!vertical.some((other) => same(other, line))) vertical.push(line)
	}
	return { horizontal, vertical }
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

// the best distinct quads around the image's centre, by edge support; `accept`: only these (snap: near the corners)
function coarseQuads(image: Grey, accept: (quad: Quad) => boolean = () => true): Quad[] {
	const { horizontal, vertical } = lines(image)
	// y of a horizontal line at the image center column, x of a vertical line at the center row
	const center = { x: image.width / 2, y: image.height / 2 }
	const position = (l: Line) => (Math.abs(l.n.y) > 0.9 ? (l.rho - l.n.x * center.x) / l.n.y : (l.rho - l.n.y * center.y) / l.n.x)
	const scored: { quad: Quad; score: number }[] = []
	for (const [i, a] of horizontal.entries())
		for (const b of horizontal.slice(i + 1))
			for (const [j, c] of vertical.entries())
				for (const d of vertical.slice(j + 1)) {
					const [top, bottom] = position(a) < position(b) ? [a, b] : [b, a]
					const [left, right] = position(c) < position(d) ? [c, d] : [d, c]
					const quad = corners([top, right, bottom, left])
					if (!quad.every((p) => inside(p, image))) continue
					// the painting is what the photo is taken of: its centre is on it
					if (!contains(quad, center)) continue
					if (!accept(quad)) continue
					const area = polygonArea(quad) / (image.width * image.height)
					if (area < 0.05) continue
					const supports = sidesOf(quad).map(([from, to]) => support(image, from, to))
					const score = Math.min(...supports) * 0.7 + (supports.reduce((s, v) => s + v, 0) / 4) * 0.3 + 0.1 * area
					scored.push({ quad, score })
				}
	scored.sort((a, b) => b.score - a.score)
	const best: Quad[] = []
	for (const { quad } of scored) {
		if (best.length >= CANDIDATES) break
		if (!best.some((other) => largestDistance(other, quad) < 3)) best.push(quad)
	}
	return best
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

// search ±range px across the side: [at from, at to], in between linear
function refineSide(image: Grey, from: Point, to: Point, range: [number, number], prior: Coefficients = [0, 0, 0]) {
	const SAMPLES = 80
	const n = inward(from, to)
	// per sample: the best positive and the best negative step across the side. Both compete: the background behind
	// a canvas can change along a side (dark, then wood), only lying on one curve with the others decides
	const peaks: Peak[] = []
	for (let i = 0; i < SAMPLES; i++) {
		const t = 0.04 + (0.92 * i) / (SAMPLES - 1)
		const reach = Math.max(1, Math.round(range[0] + (range[1] - range[0]) * t))
		const center = offsetAt(prior, t)
		const base = { x: from.x + (to.x - from.x) * t + n.x * center, y: from.y + (to.y - from.y) * t + n.y * center }
		const profile: number[] = []
		for (let o = -reach - 3; o <= reach + 3; o++) profile.push(sample(image, base.x + n.x * o, base.y + n.y * o))
		const best: { positive: Peak | null; negative: Peak | null } = { positive: null, negative: null }
		const steps: number[] = [] // steps[k]: derivative at offset k − reach
		for (let k = 3; k < profile.length - 3; k++) steps.push((profile[k + 2]! - profile[k - 2]!) / 4)
		for (let k = 1; k < steps.length - 1; k++) {
			const s = steps[k]!
			if (!Number.isFinite(s) || Math.abs(s) < 2) continue
			if (Math.abs(s) < Math.abs(steps[k - 1]!) || Math.abs(s) < Math.abs(steps[k + 1]!)) continue
			// sub-pixel: parabola through the neighbouring steps
			const [l, r] = [steps[k - 1]!, steps[k + 1]!]
			const denominator = l - 2 * s + r
			const shift = denominator !== 0 ? Math.max(-0.5, Math.min(0.5, (0.5 * (l - r)) / denominator)) : 0
			const peak = { t, o: center + k - reach + shift, strength: Math.abs(s) }
			const key = s > 0 ? 'positive' : 'negative'
			if (!best[key] || peak.strength > best[key].strength) best[key] = peak
		}
		if (best.positive) peaks.push(best.positive)
		if (best.negative) peaks.push(best.negative)
	}
	if (peaks.length < 6) return null

	// RANSAC: curve through 3 random peaks (start, middle, end) with the most peaks within 1.5 px
	const TOLERANCE = 1.5
	const within = (coefficients: Coefficients) => peaks.filter((p) => Math.abs(offsetAt(coefficients, p.t) - p.o) < TOLERANCE)
	const pick = (lo: number, hi: number) => {
		const candidates = peaks.filter((p) => p.t >= lo && p.t < hi)
		return candidates[Math.floor(random() * candidates.length)]
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
		inliers: Math.min(1, best.length / SAMPLES),
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

// How clearly the sides are edges: per side the share of points along it with a step across (either sign), the
// parts next to the corners weighted most (a side running on past the canvas has none there); mean over the sides.
// A gap costs a whole point: next to a corner, no difference at all across the side for GAP_LENGTH px (a side running
// on past the canvas through the black between canvas and trestle). Canvas corners never show one.
const SCORE_SAMPLES = 200
const SCORE_OFFSET = 6 // px on both sides of the curve
const SCORE_STEP = 6 // grey levels
const GAP_LENGTH = 60 // px from the corner
const GAP_STEP = 3 // grey levels
const cornerWeight = (t: number) => 1 + 3 * (2 * t - 1) ** 4
function edgeScore(image: Grey, curves: Curve[], joints: { s: number; u: number }[]) {
	let total = 0
	let gaps = 0
	curves.forEach((curve, k) => {
		const start = joints[k]!.u
		const end = joints[(k + 1) % 4]!.s
		const step = (t: number) => {
			const p = pointAt(curve, t)
			return Math.abs(sample(image, p.x + curve.n.x * SCORE_OFFSET, p.y + curve.n.y * SCORE_OFFSET) - sample(image, p.x - curve.n.x * SCORE_OFFSET, p.y - curve.n.y * SCORE_OFFSET))
		}
		let clear = 0
		let weights = 0
		for (let i = 0; i < SCORE_SAMPLES; i++) {
			const t = (i + 0.5) / SCORE_SAMPLES
			const weight = cornerWeight(t)
			weights += weight
			if (step(start + (end - start) * t) > SCORE_STEP) clear += weight
		}
		total += clear / weights
		// from each corner inwards, every 3 px (curve parameter: 1 = the rough side's length)
		const length = Math.hypot(curve.to.x - curve.from.x, curve.to.y - curve.from.y)
		const direction = Math.sign(end - start)
		for (const [corner, inwards] of [[start, direction], [end, -direction]] as const) {
			let gap = true
			for (let d = 6; d <= GAP_LENGTH + 3 && gap; d += 3) if (!(step(corner + (inwards * d) / length) < GAP_STEP)) gap = false
			if (gap) gaps++
		}
	})
	return total / 4 - gaps
}

// ranges: per side [at its start, at its end]; [0, 0]: not searched. keepUnfound: a side without edge stays the straight
// side given (snap)
function refine(image: Grey, quad: Quad, ranges: [number, number][], keepUnfound = false) {
	const sides = sidesOf(quad)
	const unfound: number[] = []
	let results = sides.map(([from, to], i) => {
		const searched = ranges[i]![0] > 0 || ranges[i]![1] > 0
		const found = searched ? refineSide(image, from, to, ranges[i]!) : null
		if (found || !keepUnfound) return found
		unfound.push(i)
		return { curve: { from, to, n: inward(from, to), coefficients: [0, 0, 0] as Coefficients }, inliers: 0, contrast: 0 }
	})
	if (results.some((r) => !r)) return null
	// second pass with profiles centered on the found curves: short search, no stray edges
	results = sides.map(([from, to], i) =>
		unfound.includes(i) ? results[i]! : (refineSide(image, from, to, [6, 6], results[i]!.curve.coefficients) ?? results[i]!),
	)
	const curves = results.map((r) => r!.curve)
	// corner k: end of side k − 1 meets start of side k
	const joints = curves.map((curve, k) => meet(curves[(k + 3) % 4]!, curve))
	const quadOut = joints.map((j) => j.point) as Quad
	const detection: Detection = {
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
	return { detection, score: edgeScore(image, curves, joints), unfound }
}

const scale = (quad: Quad, factor: number) => quad.map((p) => ({ x: p.x * factor, y: p.y * factor })) as Quad

// good enough to skip the human: clear edges on all sides, square corners in 3D, little bow
export function trusted(d: Detection, camera: Camera) {
	const shape = reconstruct(d.quad, camera)
	const longSide = Math.max(camera.width, camera.height)
	return (
		d.sides.every((side) => side.inliers >= MIN_INLIERS && Math.abs(side.bowPx) < longSide * 0.005) &&
		(!shape || shape.angleErrorDeg < MAX_ANGLE_ERROR)
	)
}

// how far a rough quad (previous painting, corners placed by hand) may be off: 4 % of the photo's long side
const hintRange = (image: Grey) => Math.round(Math.max(image.width, image.height) * 0.04)
const evenly = (range: number): [number, number][] => [0, 1, 2, 3].map(() => [range, range])

// corners of the painting in `file` (the lens-corrected photo); `hint`: rough corners (previous painting), refined as
// one more candidate
export async function detectCorners(file: string, hint?: Quad | null): Promise<Detection | null> {
	seed = 1
	const [full, small] = await Promise.all([fullGrey(file), grey(file, COARSE_SIZE, 1)])
	const factor = full.width / small.width
	const starts = coarseQuads(small).map((quad) => ({ quad: scale(quad, factor), ranges: evenly(Math.ceil(factor * 3) + 4) }))
	if (hint) starts.push({ quad: hint, ranges: evenly(hintRange(full)) })
	const center = { x: full.width / 2, y: full.height / 2 }
	let best: { detection: Detection; score: number } | null = null
	for (const { quad, ranges } of starts) {
		const refined = refine(full, quad, ranges)
		if (!refined) continue
		const score = contains(refined.detection.quad, center) ? refined.score : -1
		if (!best || score > best.score) best = { detection: refined.detection, score }
	}
	return best && upright(best.detection)
}

// a quad's corners in the order of `reference`'s (the nearest of the 4 rotations): candidates start top left in the
// photo, corners placed by hand start top left in the (maybe turned) view
function alignedTo(quad: Quad, reference: Quad): Quad {
	const rotations = [0, 1, 2, 3].map((r) => quad.map((_, i) => quad[(i + r) % 4]!) as Quad)
	const spread = (q: Quad) => q.reduce((s, p, k) => s + Math.hypot(p.x - reference[k]!.x, p.y - reference[k]!.y), 0)
	return rotations.reduce((a, b) => (spread(b) < spread(a) ? b : a))
}

// "snap": the detection again, with the corners placed by hand as limits: every corner ends within its radius of where
// it was placed (`radii`: a corner moved by hand only near where it was put; null: free, the usual 4 %). The best quad
// within the limits wins, so a corner moved off a wrong edge takes the other end of that edge along. Candidates: the
// coarse quads within the limits, and the placed corners refined in place. Nothing found: the corners stay as placed.
export async function snapCorners(file: string, quad: Quad, radii: (number | null)[]) {
	seed = 1
	const [full, small] = await Promise.all([fullGrey(file), grey(file, COARSE_SIZE, 1)])
	const factor = full.width / small.width
	const coarseRange = Math.ceil(factor * 3) + 4
	// after a drag, only dragged corners are held; the others go wherever the best edges are (the placed rect may be far
	// off). Nothing dragged: everything stays near where it is
	const dragged = radii.some((r) => r !== null)
	const limits = radii.map((r) => r ?? (dragged ? Infinity : hintRange(full)))
	const within = (candidate: Quad, slack: number) =>
		alignedTo(candidate, quad).every((p, k) => Math.hypot(p.x - quad[k]!.x, p.y - quad[k]!.y) <= limits[k]! + slack)
	const starts = coarseQuads(small, (q) => within(scale(q, factor), coarseRange)).map((q) => ({ quad: scale(q, factor), ranges: evenly(coarseRange) }))
	// the placed corners refined in place: both sides of a limited corner searched only within its radius
	const sideRadius = (k: number) => Math.min(limits[k]!, limits[(k + 1) % 4]!, hintRange(full))
	starts.push({ quad, ranges: [0, 1, 2, 3].map((k): [number, number] => [sideRadius(k), sideRadius(k)]) })
	let best: { detection: Detection; score: number } | null = null
	for (const { quad: start, ranges } of starts) {
		const refined = refine(full, start, ranges)
		if (!refined || !within(refined.detection.quad, 1)) continue
		if (!best || refined.score > best.score) best = refined
	}
	if (best) return { detection: upright(best.detection), unsnapped: 0 }
	const placed = refine(full, quad, [0, 1, 2, 3].map((): [number, number] => [0, 0]), true)!
	return { detection: upright(placed.detection), unsnapped: 4 }
}

// corners (and sides) in the photo's orientation, starting top left: a hint may come in the painting's
// orientation (rotated view in the capture UI), which the UI applies again
function upright(detection: Detection): Detection {
	const sums = detection.quad.map((p) => p.x + p.y)
	const first = sums.indexOf(Math.min(...sums))
	const turn = <T>(items: T[]) => items.map((_, i) => items[(i + first) % 4]!)
	return { quad: turn(detection.quad) as Quad, sides: turn(detection.sides) }
}

// ---------- curve of a side between given corners (found automatically or placed by hand) ----------
// The corners stay where they are; only the parabola between them is searched: offset(t) = bow·4t(1 − t) along the
// inward normal. Every allowed bow is tried and the one running along the strongest step wins. A straight line that isn't
// the painting's edge (wall, frame, painted border) doesn't fit such a curve along its whole length.

// bowPx: + = inwards. clear: false means no edge was found along the side; it then counts as straight
export type Bow = { bowPx: number; clear: boolean }

const CURVE_SAMPLES = 160
const STEP_OFFSET = 3 // px on both sides of the curve
const CLEAR_STEP = 12 // grey levels, as in `support`

function stepsAlong(image: Grey, from: Point, to: Point, n: Point, bow: number) {
	const steps: number[] = []
	for (let i = 0; i < CURVE_SAMPLES; i++) {
		const t = 0.04 + (0.92 * i) / (CURVE_SAMPLES - 1)
		const offset = bow * 4 * t * (1 - t)
		const x = from.x + (to.x - from.x) * t + n.x * offset
		const y = from.y + (to.y - from.y) * t + n.y * offset
		const step = sample(image, x + n.x * STEP_OFFSET, y + n.y * STEP_OFFSET) - sample(image, x - n.x * STEP_OFFSET, y - n.y * STEP_OFFSET)
		if (Number.isFinite(step)) steps.push(step)
	}
	return steps
}

function measureBow(image: Grey, from: Point, to: Point): Bow {
	const n = inward(from, to)
	const limit = MAX_BOW * Math.hypot(to.x - from.x, to.y - from.y)
	const STEP = 0.5
	// consistent sign: the painting is brighter or darker than what's behind it
	const strength = (bow: number) => Math.abs(stepsAlong(image, from, to, n, bow).reduce((sum, step) => sum + step, 0))
	const count = Math.floor(limit / STEP)
	const scores = Array.from({ length: 2 * count + 1 }, (_, k) => strength((k - count) * STEP))
	const best = scores.indexOf(Math.max(...scores))
	const steps = stepsAlong(image, from, to, n, (best - count) * STEP)
	const sign = Math.sign(steps.reduce((sum, step) => sum + step, 0))
	const clear = steps.filter((step) => step * sign > CLEAR_STEP).length >= CURVE_SAMPLES * MIN_INLIERS
	if (!clear) return { bowPx: 0, clear }
	// sub-pixel: parabola through the neighbouring scores
	const [l, s, r] = [scores[best - 1] ?? 0, scores[best]!, scores[best + 1] ?? 0]
	const denominator = l - 2 * s + r
	const shift = denominator ? Math.max(-0.5, Math.min(0.5, (0.5 * (l - r)) / denominator)) : 0
	const bowPx = Math.max(-limit, Math.min(limit, (best - count + shift) * STEP))
	return { bowPx, clear }
}

// per side of `quad` (top, right, bottom, left, in the quad's own order)
export async function measureBows(file: string, quad: Quad): Promise<Bow[]> {
	const image = await fullGrey(file)
	return sidesOf(quad).map(([from, to]) => measureBow(image, from, to))
}
