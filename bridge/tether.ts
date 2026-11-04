// The tethered camera (gphoto2). Paintings are photographed with fixed settings, so their brightness and colour stay
// comparable: edit `fixedSettings` to change them. Shutter and colour temperature come from the colour calibration.
//
// Sony specifics: the exposure program follows the physical dial (setting it via USB is silently ignored), and the
// other values are read-only unless the dial is on M. Written values take a moment to show up in reads, so what the
// camera really did is checked in each photo's EXIF.
import { execFile } from 'node:child_process'
import { mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import { promisify } from 'node:util'
import type { Exposure } from './camera'

const run = promisify(execFile)

export const fixedSettings = {
	iso: 100,
	fNumber: 5.6,
	dro: 'Off', // Sony's automatic contrast changes per image
	quality: 'RAW+JPEG (X.Fine)', // the RAW keeps exposure and colour correctable later; 'Extra Fine' for JPEG only
}

// third stops from long to short
export const shutterSpeeds = [
	'8', '6', '5', '4', '32/10', '25/10', '2', '16/10', '13/10', '1', '8/10', '6/10', '5/10', '4/10', '1/3', '1/4', '1/5', '1/6', '1/8',
	'1/10', '1/13', '1/15', '1/20', '1/25', '1/30', '1/40', '1/50', '1/60', '1/80', '1/100', '1/125', '1/160', '1/200', '1/250', '1/320',
	'1/400', '1/500', '1/640', '1/800', '1/1000',
]
export const shutterSeconds = (speed: string) => {
	const [a, b] = speed.split('/')
	return Number(a) / Number(b ?? 1)
}

export type CameraExposure = { shutter: string; kelvin: number }

// A camera that does not fire (asleep, no focus) is given up on instead of hanging for minutes. A capture may take long:
// up to 8 s exposure + the RAW download. SIGTERM (not SIGKILL) lets gphoto2 cancel and close the PTP session — a killed
// session leaves the camera's USB stuck until power-cycled.
const TIMEOUT = 20_000
const CAPTURE_TIMEOUT = 40_000

function friendly(error: { killed?: boolean; stderr?: string; message: string }) {
	const output = error.stderr || error.message
	if (error.killed || /PTP Timeout/i.test(output))
		return 'camera did not respond in time (no focus? asleep?) — try again; if it repeats, switch the camera off and on'
	if (/Could not claim|resource busy/i.test(output))
		return 'camera is busy: another program holds it. Run `pkill -f gvfs-gphoto2-volume-monitor` or replug the camera, then try again'
	if (/No camera found|-105/i.test(output)) return 'no camera found — check USB cable and USB Connection = PC Remote'
	return output.trim().split('\n').slice(-2).join(' | ')
}

async function gphoto2(args: string[], timeout = TIMEOUT) {
	try {
		return (await run('gphoto2', args, { timeout, killSignal: 'SIGTERM' })).stdout
	} catch (error) {
		throw new Error(friendly(error as { killed?: boolean; stderr?: string; message: string }))
	}
}

const pause = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

// one camera operation at a time
let busy = false
export async function exclusive<T>(task: () => Promise<T>) {
	if (busy) throw new Error('the camera is busy with another capture')
	busy = true
	try {
		return await task()
	} finally {
		busy = false
	}
}

// what the camera was last set to by this process; null: it may have changed, set everything again
let current: CameraExposure | null = null
export const currentExposure = () => current
export const forgetCameraState = () => {
	current = null
}

export async function setFixedSettings() {
	const program = /Current: (.*)/.exec(await gphoto2(['--get-config', 'expprogram']))?.[1]
	if (program !== 'M') throw new Error(`turn the camera's mode dial to M (it is on "${program}")`)
	await gphoto2([
		'--set-config', `iso=${fixedSettings.iso}`,
		'--set-config', `f-number=f/${fixedSettings.fNumber}`,
		'--set-config', `dro=${fixedSettings.dro}`,
		'--set-config', `imagequality=${fixedSettings.quality}`,
		'--set-config', 'whitebalance=Choose Color Temperature',
	])
	current = null
}

export async function setExposure(exposure: CameraExposure) {
	const args: string[] = []
	if (exposure.shutter !== current?.shutter) args.push('--set-config', `shutterspeed=${exposure.shutter}`)
	// writable only once the white balance mode has arrived: a separate call, retried
	if (exposure.kelvin !== current?.kelvin) args.push('--set-config', `colortemperature=${exposure.kelvin}`)
	if (!args.length) return
	await gphoto2(args).catch(async () => {
		await pause(1000)
		await gphoto2(args)
	})
	await pause(1000)
	current = exposure
}

// everything set as `exposure`; skipped when it already is (the settings take about 10 s)
export async function ensureLocked(exposure: CameraExposure) {
	if (!current) await setFixedSettings()
	await setExposure(exposure)
}

// fire and download. Returns the JPEG; a RAW of the same name lies next to it
export async function shoot(dir: string): Promise<string> {
	await mkdir(dir, { recursive: true })
	const stamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\..*/, '')
	const stdout = await gphoto2(['--capture-image-and-download', '--force-overwrite', '--filename', join(dir, `${stamp}.%C`)], CAPTURE_TIMEOUT)
	const saved = [...stdout.matchAll(/Saving file as (\S+)/g)].map((m) => m[1]!)
	const jpeg = saved.find((file) => /\.jpe?g$/i.test(file))
	if (!jpeg) throw new Error(saved.length ? 'no JPEG captured — check the camera\'s file format' : 'camera did not take a picture — try again')
	return jpeg
}

// what differs between the photo's EXIF and the locked settings
export function exposureMismatch(actual: Exposure | null, shutter: string) {
	if (!actual) return ['no exposure data in this photo']
	const problems = []
	if (actual.program !== 1) problems.push('mode dial is not on M')
	if (actual.iso !== fixedSettings.iso) problems.push(`ISO ${actual.iso} instead of ${fixedSettings.iso}`)
	if (Math.abs(actual.fNumber - fixedSettings.fNumber) > 0.05) problems.push(`f/${actual.fNumber} instead of f/${fixedSettings.fNumber}`)
	if (Math.abs(Math.log2(actual.shutter / shutterSeconds(shutter))) > 0.15) problems.push(`shutter ${actual.shutter} s instead of ${shutter} s`)
	return problems
}
