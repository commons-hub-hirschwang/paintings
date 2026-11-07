// Colour calibration: a white area of a painting, photographed in the session's light, sets the shutter speed (white
// lands at the chosen level, whites no longer turn grey) and the white balance (that area becomes neutral). The result
// applies to all following paintings alike: nothing is adjusted per painting, so a painting's own colour bias stays.
//
// White balance has two parts: the camera's colour temperature does amber↔blue without loss (also in the RAW), and
// channel gains on the JPEG do the small rest, including green↔magenta, which the colour temperature can't reach.
import { existsSync } from 'node:fs'
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { basename } from 'node:path'
import sharp from 'sharp'
import { exposureOf } from './camera'
import { projectPath } from './project'
import { currentExposure, exposureMismatch, fixedSettings, isoChoices, setExposure, setFixedSettings, shoot, shutterSeconds, shutterSpeeds, type CameraExposure } from './tether'
import { readOriented } from './warp'

export type Box = { left: number; top: number; width: number; height: number }
export type Gains = [r: number, g: number, b: number]
export type ColorCalibration = CameraExposure & {
	fNumber: number
	gains: Gains
	box: Box // the white area in the photo; recalibrate with the same painting and area
	target: number // the chosen brightness of the area (0–255)
	white: number // the brightness it got
	createdAt: number
	warnings: string[]
}

export const DEFAULT_WHITE = 242 // 0–255, leaves room for anything brighter than the calibration white
const WHITE_RANGE = [180, 248] // above: too close to where the measurement counts as clipped
// the shutter only has third stops: the gains close the rest of the way to the chosen level, at most this far
const FINE_EXPOSURE = 2 ** (1 / 3)
const LAST_FLICKER_FREE = 1 / 50 // shorter exposures can show the flicker of mains-powered lights
const MAX_SHOTS = 6
const START = { shutter: '1/2', kelvin: 5000 } // at DEFAULT_ISO
export const DEFAULT_ISO = 400

// mired = 1e6 / kelvin; change of ln(red/blue) per mired, a first guess, then measured from the shots
const RED_BLUE_PER_MIRED = -0.006
const NEUTRAL_RED_BLUE = 0.03 // within 100 K of steps

const dir = () => projectPath('color')
const shots = () => projectPath('color', 'shots')
const calibrationFile = () => projectPath('color', 'calibration.json')
export const colorFile = (name: 'reference.jpg' | 'patch.jpg') => projectPath('color', name)
export const shotFile = (file: string) => projectPath('color', 'shots', basename(file))

export const readColorCalibration = async (): Promise<ColorCalibration | null> =>
	existsSync(calibrationFile()) ? JSON.parse(await readFile(calibrationFile(), 'utf8')) : null

const toLinear = (value: number) => {
	const v = value / 255
	return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4
}
const fromLinear = (v: number) => 255 * (v <= 0.0031308 ? 12.92 * v : 1.055 * v ** (1 / 2.4) - 0.055)
const luminance = (r: number, g: number, b: number) => 0.2126 * r + 0.7152 * g + 0.0722 * b

// white balance gains in linear light, through a lookup table per channel: black stays black
const gainTable = (gain: number) => Uint8Array.from({ length: 256 }, (_, v) => Math.min(255, Math.round(fromLinear(toLinear(v) * gain))))
export function applyGains(data: Buffer, gains: Gains) {
	const [r, g, b] = gains.map(gainTable) as [Uint8Array, Uint8Array, Uint8Array]
	for (let i = 0; i < data.length; i += 3) {
		data[i] = r[data[i]!]!
		data[i + 1] = g[data[i + 1]!]!
		data[i + 2] = b[data[i + 2]!]!
	}
	return data
}

const CLIPPED = 254

// share of the box's pixels that are (with the gains applied: would be) clipped in any channel
export function clippedShare(image: { data: Buffer; width: number; height: number }, box: Box, gains?: Gains) {
	const [tr, tg, tb] = (gains ?? [1, 1, 1]).map((gain) => {
		const first = gains ? gainTable(gain).findIndex((value) => value >= CLIPPED) : CLIPPED
		return first < 0 ? 256 : first
	}) as [number, number, number]
	const { data, width } = image
	const { left, top, right, bottom } = bounds(image, box)
	let clipped = 0
	for (let y = top; y < bottom; y++) {
		const end = (y * width + right) * 3
		for (let i = (y * width + left) * 3; i < end; i += 3) if (data[i]! >= tr || data[i + 1]! >= tg || data[i + 2]! >= tb) clipped++
	}
	return clipped / Math.max(1, (right - left) * (bottom - top))
}

const bounds = (image: { width: number; height: number }, box: Box) => ({
	left: Math.max(0, Math.round(box.left)),
	top: Math.max(0, Math.round(box.top)),
	right: Math.min(image.width, Math.round(box.left + box.width)),
	bottom: Math.min(image.height, Math.round(box.top + box.height)),
})

// medians per channel are robust against specks; the spread tells whether the area is really one colour
export function measure(image: { data: Buffer; width: number; height: number }, box: Box) {
	const histograms = [new Uint32Array(256), new Uint32Array(256), new Uint32Array(256)] as const
	const { left, top, right, bottom } = bounds(image, box)
	let clipped = 0
	for (let y = top; y < bottom; y++) {
		for (let x = left; x < right; x++) {
			const i = (y * image.width + x) * 3
			const r = image.data[i]!
			const g = image.data[i + 1]!
			const b = image.data[i + 2]!
			histograms[0][r]!++
			histograms[1][g]!++
			histograms[2][b]!++
			if (r >= CLIPPED || g >= CLIPPED || b >= CLIPPED) clipped++
		}
	}
	const count = Math.max(1, (right - left) * (bottom - top))
	const percentile = (histogram: Uint32Array, share: number) => {
		let seen = 0
		for (let v = 0; v < 256; v++) if ((seen += histogram[v]!) >= share * count) return v
		return 255
	}
	const [r, g, b] = histograms.map((h) => percentile(h, 0.5)) as [number, number, number]
	return {
		rgb: [r, g, b] as Gains,
		linear: [toLinear(r), toLinear(g), toLinear(b)] as Gains,
		spread: percentile(histograms[1], 0.95) - percentile(histograms[1], 0.05),
		high: percentile(histograms[1], 0.99),
		clippedShare: clipped / count,
	}
}

const nearestShutter = (seconds: number) =>
	shutterSpeeds.reduce((best, speed) =>
		Math.abs(Math.log2(shutterSeconds(speed) / seconds)) < Math.abs(Math.log2(shutterSeconds(best) / seconds)) ? speed : best,
	)

// A shot to mark the white area in. The light is unknown in manual mode, so the shutter is first brought to where the
// photo shows something: its brightest parts mid to high, measured over the whole frame.
export async function takeReference(iso: number) {
	if (!isoChoices.includes(iso)) throw new Error(`ISO ${iso} is not one of ${isoChoices.join(', ')}`)
	await rm(shots(), { recursive: true, force: true })
	const previous = await readColorCalibration()
	await setFixedSettings()
	// from the last calibration's light, whatever its ISO was
	const start = previous ?? { ...START, iso: DEFAULT_ISO }
	let exposure: CameraExposure = { shutter: nearestShutter((shutterSeconds(start.shutter) * start.iso) / iso), kelvin: start.kelvin, iso }
	let file = ''
	for (let attempt = 0; attempt < 4; attempt++) {
		await setExposure(exposure)
		file = await shootRetrying()
		const image = await readOriented(file)
		const { high } = measure(image, { left: 0, top: 0, width: image.width, height: image.height })
		if (high >= 90 && high <= 240) break
		// clipped or nearly black: the measured value says little, so the steps are limited
		const ratio = Math.max(1 / 8, Math.min(16, toLinear(190) / Math.max(toLinear(high), 0.001)))
		const next = nearestShutter(shutterSeconds(exposure.shutter) * (high > 240 ? 1 / 4 : ratio))
		if (next === exposure.shutter) break
		exposure = { ...exposure, shutter: next }
	}
	return { file: basename(file), previous }
}

// the first shot after settings changed can fail while the camera is still focusing
const shootRetrying = () => shoot(shots()).catch(() => shoot(shots()))

// From the marked area in the reference shot to shutter + colour temperature (reshooting until they settle) and gains.
export async function calibrateColor(file: string, box: Box, target = DEFAULT_WHITE): Promise<ColorCalibration> {
	if (!(target >= WHITE_RANGE[0]! && target <= WHITE_RANGE[1]!)) throw new Error(`white level must be ${WHITE_RANGE.join('–')}`)
	let exposure = currentExposure()
	if (!exposure) throw new Error('the camera was reset in between — take the reference photo again')
	if (box.width < 8 || box.height < 8) throw new Error('mark a larger white area')
	let photo = shotFile(file)
	if (!existsSync(photo)) throw new Error(`no reference photo "${file}"`)
	let last: { mired: number; redBlue: number } | null = null

	for (let shot = 1; ; shot++) {
		const image = await readOriented(photo)
		const { linear, rgb, spread } = measure(image, box)
		const [r, g, b] = linear
		const white = luminance(r, g, b)

		// shutter: clipped means the real value is unknown, so step down until it isn't
		const seconds = shutterSeconds(exposure.shutter)
		const clipped = Math.max(...rgb) >= 250
		const shutter: string = nearestShutter(clipped ? seconds / 2 : (seconds * toLinear(target)) / Math.max(white, 0.001))

		// colour temperature: where ln(red/blue) reaches 0, along the slope measured between the last two shots
		const redBlue = Math.log(Math.max(r, 0.001) / Math.max(b, 0.001))
		const mired = 1e6 / exposure.kelvin
		const measuredSlope: number | null = last && Math.abs(mired - last.mired) > 2 ? (redBlue - last.redBlue) / (mired - last.mired) : null
		const slope = measuredSlope !== null && measuredSlope < -0.001 ? measuredSlope : RED_BLUE_PER_MIRED
		last = { mired, redBlue }
		const kelvin: number =
			Math.abs(redBlue) < NEUTRAL_RED_BLUE
				? exposure.kelvin
				: Math.min(9900, Math.max(2500, Math.round(1e6 / (mired - redBlue / slope) / 100) * 100))

		const settled = shutter === exposure.shutter && kelvin === exposure.kelvin
		if (settled || shot === MAX_SHOTS) {
			const warnings = reviewCalibration({ white, rgb, spread, seconds, settled, linear })
			return saveCalibration(image, box, exposure, linear, target, warnings)
		}
		exposure = { shutter, kelvin, iso: exposure.iso }
		await setExposure(exposure)
		photo = await shootRetrying()
		// every measurement must come from a photo really taken with these settings
		const mismatch = exposureMismatch(await exposureOf(photo), exposure)
		if (mismatch.length) throw new Error(`the camera didn't take the settings: ${mismatch.join(', ')}`)
	}
}

function reviewCalibration({ white, rgb, spread, seconds, settled, linear }: { white: number; rgb: Gains; spread: number; seconds: number; settled: boolean; linear: Gains }) {
	const warnings = []
	const [r, g, b] = linear
	const off = Math.max(...[r, g, b].map((channel) => Math.abs(Math.log(white / Math.max(channel, 0.001)))))
	if (spread > 40) warnings.push('The marked area is not one even colour — mark a smaller, cleaner white.')
	if (Math.max(...rgb) >= 250) warnings.push('The white is overexposed: its colour could not be measured reliably.')
	if (!settled) warnings.push('Exposure and colour did not fully settle — is the light changing?')
	if (off > 0.15) warnings.push(`Large colour correction left (${Math.round(off * 100)} %) — mixed light, or a white that isn't neutral?`)
	if (seconds < LAST_FLICKER_FREE) warnings.push('Shutter faster than 1/50 s: mains-powered lights can flicker into the brightness. Fine in daylight.')
	if (seconds > 1) warnings.push('Long exposure: avoid touching the camera or tripod. A higher ISO shortens it.')
	return warnings
}

async function saveCalibration(image: { data: Buffer; width: number; height: number }, box: Box, exposure: CameraExposure, linear: Gains, target: number, warnings: string[]) {
	await mkdir(dir(), { recursive: true })
	const [r, g, b] = linear
	const measured = luminance(r, g, b)
	const level = measured * Math.min(FINE_EXPOSURE, Math.max(1 / FINE_EXPOSURE, toLinear(target) / Math.max(measured, 0.001)))
	const gains: Gains = [level / Math.max(r, 0.001), level / Math.max(g, 0.001), level / Math.max(b, 0.001)]
	const calibration: ColorCalibration = {
		...exposure,
		fNumber: fixedSettings.fNumber,
		gains,
		box,
		target,
		white: Math.round(fromLinear(level)),
		createdAt: Date.now(),
		warnings,
	}
	// for the next recalibration: which painting and area to use
	const corrected = sharp(applyGains(Buffer.from(image.data), gains), { raw: { width: image.width, height: image.height, channels: 3 } })
	const scaled = await corrected.clone().resize({ width: 1600, height: 1600, fit: 'inside' }).jpeg({ quality: 85 }).toBuffer()
	const margin = Math.max(box.width, box.height)
	const left = Math.max(0, Math.round(box.left - margin))
	const top = Math.max(0, Math.round(box.top - margin))
	const patch = await corrected
		.clone()
		.extract({
			left,
			top,
			width: Math.min(image.width, Math.round(box.left + box.width + margin)) - left,
			height: Math.min(image.height, Math.round(box.top + box.height + margin)) - top,
		})
		.resize({ width: 400, height: 400, fit: 'inside' })
		.jpeg({ quality: 85 })
		.toBuffer()
	await writeFile(colorFile('reference.jpg'), scaled)
	await writeFile(colorFile('patch.jpg'), patch)
	await writeFile(calibrationFile(), JSON.stringify(calibration, null, '\t'))
	await rm(shots(), { recursive: true, force: true }).catch(() => {})
	return calibration
}

// the calibration to apply to a photo: only one really taken with its settings (not a phone upload or an older auto shot)
export async function correctionFor(photo: string) {
	const calibration = await readColorCalibration()
	const actual = await exposureOf(photo)
	if (!calibration || !actual) return null
	const sameShutter = Math.abs(Math.log2(actual.shutter / shutterSeconds(calibration.shutter))) < 0.15
	const same = sameShutter && actual.iso === calibration.iso && Math.abs(actual.fNumber - calibration.fNumber) < 0.05 && actual.program === 1
	return same ? calibration : null
}
