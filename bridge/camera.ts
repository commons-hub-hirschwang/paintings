// Photo size + focal length in pixels from EXIF, for the 3D size reconstruction (shared/geometry.ts).
import exifReader from 'exif-reader'
import sharp from 'sharp'
import type { Camera } from '../shared/geometry'

// sensor width (long side, mm) of known cameras: exact focal length in pixels from the real focal length
const sensorWidthMm: Record<string, number> = { 'ILCE-6400': 23.5 }

export async function cameraOf(file: string): Promise<Camera> {
	const meta = await sharp(file).metadata()
	// orientations 5–8 are rotated by 90°: the editor shows the photo upright
	const rotated = (meta.orientation ?? 1) >= 5
	const width = (rotated ? meta.height : meta.width) ?? 0
	const height = (rotated ? meta.width : meta.height) ?? 0
	let focalPx: number | null = null
	try {
		const exif = meta.exif ? exifReader(meta.exif) : null
		const focalMm = exif?.Photo?.FocalLength
		const focal35 = exif?.Photo?.FocalLengthIn35mmFilm
		const sensor = sensorWidthMm[exif?.Image?.Model ?? '']
		if (focalMm && sensor) focalPx = (focalMm * Math.max(width, height)) / sensor
		// 35 mm equivalent is defined over the diagonal (43.27 mm), so it also works for 4:3 phone photos
		else if (focal35) focalPx = (focal35 * Math.hypot(width, height)) / Math.hypot(36, 24)
	} catch {
		// no or broken EXIF: size falls back to the frontal approximation
	}
	return { width, height, focalPx }
}
