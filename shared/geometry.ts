// Pure geometry shared by the capture UI (live size preview) and the bridge (warp).

export type Point = { x: number; y: number }
// clockwise from top-left: TL, TR, BR, BL — in pixels of the (EXIF-oriented) photo
export type Quad = [Point, Point, Point, Point]

export type Calibration = { pxPerCm: number; createdAt: number }

const distance = (a: Point, b: Point) => Math.hypot(a.x - b.x, a.y - b.y)

// average opposite edges; good enough since the painting faces the camera roughly frontally
export function quadPixelSize([tl, tr, br, bl]: Quad) {
	return {
		width: (distance(tl, tr) + distance(bl, br)) / 2,
		height: (distance(tl, bl) + distance(tr, br)) / 2,
	}
}

export function calibrate(quad: Quad, widthCm: number, heightCm: number): Calibration {
	const px = quadPixelSize(quad)
	return { pxPerCm: Math.sqrt((px.width * px.height) / (widthCm * heightCm)), createdAt: Date.now() }
}

export function estimateSizeCm(quad: Quad, calibration: Calibration) {
	const px = quadPixelSize(quad)
	return { widthCm: px.width / calibration.pxPerCm, heightCm: px.height / calibration.pxPerCm }
}

// output resolution of the rectified image: keeps the photo's pixel count, uses the real aspect ratio
export function rectifiedSize(quad: Quad, widthCm: number, heightCm: number) {
	const px = quadPixelSize(quad)
	const scale = Math.sqrt((px.width * px.height) / (widthCm * heightCm))
	return { width: Math.round(widthCm * scale), height: Math.round(heightCm * scale) }
}
