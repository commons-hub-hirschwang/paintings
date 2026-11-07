// Photo size, focal length in pixels and lens from EXIF, for the 3D size reconstruction (shared/geometry.ts)
// and the lens correction (lens.ts). All in the lens-corrected, EXIF-oriented photo.
import exifReader from 'exif-reader'
import sharp from 'sharp'
import type { Camera } from '../shared/geometry'
import { lensOf } from './lens'

// sensor width (long side, mm) and crop factor of known cameras: exact focal length in pixels from the real focal length
const sensors: Record<string, { widthMm: number; crop: number }> = { 'ILCE-6400': { widthMm: 23.5, crop: 1.534 } }

export async function cameraOf(file: string): Promise<Camera> {
	const meta = await sharp(file).metadata()
	// orientations 5–8 are rotated by 90°: the editor shows the photo upright (radial lens distortion doesn't care)
	const rotated = (meta.orientation ?? 1) >= 5
	const width = (rotated ? meta.height : meta.width) ?? 0
	const height = (rotated ? meta.width : meta.height) ?? 0
	let focalPx: number | null = null
	let lens: Camera['lens'] = null
	try {
		const exif = meta.exif ? exifReader(meta.exif) : null
		const focalMm = exif?.Photo?.FocalLength
		const focal35 = exif?.Photo?.FocalLengthIn35mmFilm
		const model = exif?.Image?.Model ?? ''
		const sensor = sensors[model]
		if (focalMm && sensor) focalPx = (focalMm * Math.max(width, height)) / sensor.widthMm
		// 35 mm equivalent is defined over the diagonal (43.27 mm), so it also works for 4:3 phone photos
		else if (focal35) focalPx = (focal35 * Math.hypot(width, height)) / Math.hypot(36, 24)
		if (exif?.Photo?.LensModel && focalMm) lens = { model: exif.Photo.LensModel, focalMm, cameraCrop: sensor?.crop ?? null }
	} catch {
		// no or broken EXIF: size falls back to the frontal approximation
	}
	const correction = lensOf({ width, height, focalPx, lens })
	// the correction magnifies the image center by focalScale
	if (correction && focalPx) focalPx *= correction.focalScale
	return { width, height, focalPx, lens: correction ? lens : null }
}

export type Exposure = { shutter: number; fNumber: number; iso: number; program: number }

// null: a photo without exposure data. program 1 = manual
export async function exposureOf(file: string): Promise<Exposure | null> {
	const { exif } = await sharp(file).metadata()
	try {
		const photo = exif ? exifReader(exif).Photo : null
		if (!photo?.ExposureTime || !photo.FNumber || !photo.ISOSpeedRatings) return null
		const iso = photo.ISOSpeedRatings
		return { shutter: photo.ExposureTime, fNumber: photo.FNumber, iso: Array.isArray(iso) ? iso[0]! : iso, program: photo.ExposureProgram ?? 0 }
	} catch {
		return null
	}
}
