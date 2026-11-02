// Pure geometry shared by the capture UI (live size preview) and the bridge (warp).
//
// Real size from 4 clicked corners (pinhole camera, principal point = image center, square pixels):
//  1. each corner pixel → viewing ray r = ((u − cx) / f, (v − cy) / f, 1); the corner is P = λ·r in 3D
//  2. a rectangle's corners satisfy P0 + P2 = P1 + P3 (diagonals bisect each other). With λ0 = 1 that is a
//     3×3 linear system for λ1..λ3 → the painting in 3D up to scale: exact tilt and true aspect ratio.
//     The angle between its edges should be 90°; the deviation measures click (or focal length) error.
//  3. scale: calibration stores the depth of the measured painting's center (cm). Every later painting is
//     scaled so that its center sits at that same depth — paintings stand at about the same spot.
// Without a focal length (no EXIF) the old approximation is used: average opposite edges ÷ px/cm.

export type Point = { x: number; y: number }
// clockwise from top-left: TL, TR, BR, BL — in pixels of the (EXIF-oriented) photo
export type Quad = [Point, Point, Point, Point]

// photo size (EXIF-oriented) and focal length in pixels (null: unknown)
export type Camera = { width: number; height: number; focalPx: number | null }

// pxPerCm: at the calibration depth for a frontal painting (also the fallback without focal length)
// centerDepthCm: distance camera → center of the measured painting along the optical axis
export type Calibration = { pxPerCm: number; createdAt: number; centerDepthCm?: number; focalPx?: number }

type Vec = [number, number, number]
const sub = (a: Vec, b: Vec): Vec => [a[0] - b[0], a[1] - b[1], a[2] - b[2]]
const scale = (a: Vec, s: number): Vec => [a[0] * s, a[1] * s, a[2] * s]
const dot = (a: Vec, b: Vec) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2]
const cross = (a: Vec, b: Vec): Vec => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]]
const length = (a: Vec) => Math.sqrt(dot(a, a))
const degrees = (radians: number) => (radians * 180) / Math.PI

export type Reconstruction = {
	width: number // edge lengths, depth: in units of the (arbitrary) reconstruction scale
	height: number
	centerDepth: number
	tiltDeg: number // angle between the painting's normal and the optical axis
	angleErrorDeg: number // |90° − corner angle|
}

export function reconstruct(quad: Quad, camera: Camera): Reconstruction | null {
	const f = camera.focalPx
	if (!f) return null
	const [r0, r1, r2, r3] = quad.map((p): Vec => [(p.x - camera.width / 2) / f, (p.y - camera.height / 2) / f, 1]) as [Vec, Vec, Vec, Vec]

	// λ1·r1 − λ2·r2 + λ3·r3 = r0, by Cramer's rule with columns a, b, c
	const [a, b, c, d] = [r1, scale(r2, -1), r3, r0]
	const det = dot(a, cross(b, c))
	if (Math.abs(det) < 1e-12) return null
	const lambdas = [1, dot(d, cross(b, c)) / det, dot(a, cross(d, c)) / det, dot(a, cross(b, d)) / det]
	if (lambdas.some((l) => !(l > 0))) return null // a corner behind the camera: not a rectangle seen in this photo

	const [p0, p1, p2] = [r0, r1, r2].map((r, i) => scale(r, lambdas[i]!)) as [Vec, Vec, Vec]
	const p3 = scale(r3, lambdas[3]!)
	const top = sub(p1, p0) // = p2 − p3 exactly (parallelogram)
	const left = sub(p3, p0) // = p2 − p1
	const normal = cross(top, left)
	const center = scale([p0[0] + p2[0], p0[1] + p2[1], p0[2] + p2[2]], 0.5)
	return {
		width: length(top),
		height: length(left),
		centerDepth: center[2],
		tiltDeg: degrees(Math.acos(Math.abs(normal[2]) / length(normal))),
		angleErrorDeg: Math.abs(90 - degrees(Math.acos(dot(top, left) / (length(top) * length(left))))),
	}
}

const distance = (a: Point, b: Point) => Math.hypot(a.x - b.x, a.y - b.y)

// fallback without focal length: average opposite edges (ignores tilt foreshortening)
export function quadPixelSize([tl, tr, br, bl]: Quad) {
	return {
		width: (distance(tl, tr) + distance(bl, br)) / 2,
		height: (distance(tl, bl) + distance(tr, br)) / 2,
	}
}

export function calibrate(quad: Quad, widthCm: number, heightCm: number, camera: Camera): Calibration {
	const shape = reconstruct(quad, camera)
	if (shape) {
		const cmPerUnit = Math.sqrt((widthCm * heightCm) / (shape.width * shape.height))
		const centerDepthCm = shape.centerDepth * cmPerUnit
		return { pxPerCm: camera.focalPx! / centerDepthCm, centerDepthCm, focalPx: camera.focalPx!, createdAt: Date.now() }
	}
	const px = quadPixelSize(quad)
	return { pxPerCm: Math.sqrt((px.width * px.height) / (widthCm * heightCm)), createdAt: Date.now() }
}

export function estimateSizeCm(quad: Quad, calibration: Calibration, camera: Camera) {
	const shape = reconstruct(quad, camera)
	// calibrations made without focal length: the frontal relation px/cm = f / depth gives the depth
	const depthCm = calibration.centerDepthCm ?? (camera.focalPx ? camera.focalPx / calibration.pxPerCm : null)
	if (shape && depthCm) {
		const cmPerUnit = depthCm / shape.centerDepth
		return { widthCm: shape.width * cmPerUnit, heightCm: shape.height * cmPerUnit }
	}
	const px = quadPixelSize(quad)
	return { widthCm: px.width / calibration.pxPerCm, heightCm: px.height / calibration.pxPerCm }
}

// Output resolution of the rectified image: real aspect ratio, scaled so the longest side (in photo pixels,
// relative to its real length) keeps full resolution — the densest edge sets px/cm, so no detail is lost.
export function rectifiedSize([tl, tr, br, bl]: Quad, widthCm: number, heightCm: number) {
	const pxPerCm = Math.max(
		distance(tl, tr) / widthCm,
		distance(bl, br) / widthCm,
		distance(tl, bl) / heightCm,
		distance(tr, br) / heightCm,
	)
	return { width: Math.round(widthCm * pxPerCm), height: Math.round(heightCm * pxPerCm) }
}
