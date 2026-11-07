// Lens distortion correction with lensfun profiles (https://lensfun.github.io), so straight painting edges
// are straight in the photo and the corners form a true pinhole projection (shared/geometry.ts).
//
// The camera's own correction (Sony: Shooting menu → Lens Comp. → Distortion Comp.) must be OFF, or the
// photo gets corrected twice. Add a lens: copy `<distortion model="ptlens" …>` lines from
// /usr/share/lensfun/version_1/*.xml (or github.com/lensfun/lensfun data/db), key = EXIF LensModel.
// Matches liblensfun 0.3.4 (ApplyGeometryDistortion) to < 0.02 px.
import type { Camera, Point } from '../shared/geometry'

type Profile = {
	cropFactor: number // of the calibration camera
	aspectRatio: number // of the calibration images (lensfun default 1.5)
	ptlens: [focalMm: number, a: number, b: number, c: number][] // sorted by focal length
}

const profiles: Record<string, Profile> = {
	// Tamron 17-70mm F/2.8 Di III-A VC RXD, calibrated on a Sony A6000 (mil-tamron.xml)
	'E 17-70mm F2.8 B070': {
		cropFactor: 1.534,
		aspectRatio: 4 / 3,
		ptlens: [
			[17, 0.02392, -0.07326, 0.03809],
			[24, 0.01409, -0.02879, 0.02157],
			[35, 0.00492, 0.00706, -0.00901],
			[52, 0.01455, -0.04175, 0.07031],
			[70, 0.01162, -0.03058, 0.0507],
		],
	},
}

// lensfun's interpolation between calibrated focal lengths: Hermite spline, tangents from the neighbours
function hermite(y1: number | null, y2: number, y3: number, y4: number | null, t: number) {
	const tg2 = y1 === null ? y3 - y2 : (y3 - y1) / 2
	const tg3 = y4 === null ? y3 - y2 : (y4 - y2) / 2
	const t2 = t * t
	const t3 = t2 * t
	return (2 * t3 - 3 * t2 + 1) * y2 + (t3 - 2 * t2 + t) * tg2 + (-2 * t3 + 3 * t2) * y3 + (t3 - t2) * tg3
}

function coefficientsAt({ ptlens }: Profile, focalMm: number): [number, number, number] {
	const upper = ptlens.findIndex(([focal]) => focal >= focalMm)
	if (upper === 0 || upper === -1) {
		const [, a, b, c] = ptlens[upper === 0 ? 0 : ptlens.length - 1]!
		return [a, b, c]
	}
	const [f2] = ptlens[upper - 1]!
	const [f3] = ptlens[upper]!
	const t = (focalMm - f2) / (f3 - f2)
	// like lensfun, the spline runs over coefficient × focal length
	const at = (index: number, k: number) => (index >= 0 && index < ptlens.length ? ptlens[index]![k]! * ptlens[index]![0] : null)
	return [1, 2, 3].map((k) => hermite(at(upper - 2, k), at(upper - 1, k)!, at(upper, k)!, at(upper + 1, k), t) / focalMm) as [
		number,
		number,
		number,
	]
}

export type Lens = {
	toDistorted(point: Point): Point // corrected photo px → px in the camera's photo
	toCorrected(point: Point): Point // inverse
	// toDistorted without allocation, for per-pixel loops: distorted = center + (point − center) · scaleAt(point)
	scaleAt(x: number, y: number): number
	center: Point
	focalScale: number // magnification of the correction at the image center: focal length in px × focalScale
}

// null: unknown lens (no correction)
export function lensFor(model: string | undefined, focalMm: number | undefined, width: number, height: number, cameraCrop: number): Lens | null {
	const profile = model ? profiles[model] : undefined
	if (!profile || !focalMm) return null
	const [a, b, c] = coefficientsAt(profile, focalMm)
	const d = 1 - a - b - c
	// lensfun normalisation: 1 = half the short side of the calibration image, scaled to this camera's crop
	const imageAspect = Math.max(width, height) / Math.min(width, height)
	const unit =
		((Math.min(width, height) - 1) / 2) *
		(Math.hypot(imageAspect, 1) / Math.hypot(profile.aspectRatio, 1)) *
		(cameraCrop / profile.cropFactor)
	const cx = (width - 1) / 2
	const cy = (height - 1) / 2
	// distorted radius / corrected radius at normalised corrected radius r
	const factor = (r: number) => ((a * r + b) * r + c) * r + d
	const inverseUnit = 1 / unit
	const scaleAt = (x: number, y: number) => factor(Math.sqrt((x - cx) * (x - cx) + (y - cy) * (y - cy)) * inverseUnit)
	return {
		focalScale: 1 / d,
		center: { x: cx, y: cy },
		scaleAt,
		toDistorted({ x, y }) {
			const k = scaleAt(x, y)
			return { x: cx + (x - cx) * k, y: cy + (y - cy) * k }
		},
		toCorrected({ x, y }) {
			const rd = Math.hypot(x - cx, y - cy) / unit
			let ru = rd
			// Newton on ru·factor(ru) = rd
			for (let i = 0; i < 6; i++) {
				const f = ru * factor(ru) - rd
				const df = 4 * a * ru ** 3 + 3 * b * ru ** 2 + 2 * c * ru + d
				ru -= f / df
			}
			const k = rd > 0 ? ru / rd : 1 / d
			return { x: cx + (x - cx) * k, y: cy + (y - cy) * k }
		},
	}
}

// the lens correction of a photo, null when its lens has no profile
export const lensOf = ({ lens, width, height }: Camera): Lens | null =>
	lens && lens.cameraCrop ? lensFor(lens.model, lens.focalMm, width, height, lens.cameraCrop) : null
