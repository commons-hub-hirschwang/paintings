// A video of the gallery's paintings (all but private and deleted ones, in capture order), 1080×1920, each painting
// cropped to fill the frame. Shown `from` seconds each at the start, speeding up linearly to `to` at the end.
//   pnpm video                 0.3 s → 0.1 s
//   pnpm video 0.1 0.05
// Statuses come from the gallery's database (wrangler, env commons), images from the archive masters on this laptop.
// Out: captures/exports/crops/ (made once, shared by all videos) and captures/exports/paintings-<from>-<to>.mp4
import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, readdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import sharp from 'sharp'

const [from = 0.3, to = 0.1] = process.argv.slice(2).map(Number)
const SIZE = { width: 1080, height: 1920 }
const FPS = 60
const captures = join(import.meta.dirname, '..', 'captures')
const exports = join(captures, 'exports')
const crops = join(exports, 'crops')

type Row = { id: string; status: string; stack: string; number: number }
const query = `SELECT id, status, stack, number FROM paintings WHERE deleted_at IS NULL AND status != 'private' ORDER BY created_at`
const wrangler = execFileSync('npx', ['wrangler', 'd1', 'execute', 'paintings', '--env', 'commons', '--remote', '--json', '--command', query], {
	encoding: 'utf8',
	stdio: ['ignore', 'pipe', 'inherit'],
})
const paintings = (JSON.parse(wrangler) as { results: Row[] }[])[0]!.results

// the archive master, in whichever project it was captured
const projects = readdirSync(join(captures, 'projects'))
const archive = (id: string) => projects.map((project) => join(captures, 'projects', project, 'paintings', id, 'archive.jpg')).find(existsSync)

mkdirSync(crops, { recursive: true })
const files: string[] = []
for (const painting of paintings) {
	const file = join(crops, `${painting.stack}-${painting.number}-${painting.id.slice(0, 8)}.jpg`)
	if (!existsSync(file)) {
		const source = archive(painting.id)
		if (!source) {
			console.warn(`no archive image for ${painting.stack} #${painting.number} (${painting.id}): left out`)
			continue
		}
		await sharp(source).resize({ ...SIZE, fit: 'cover' }).jpeg({ quality: 92 }).toFile(file)
	}
	files.push(file)
}

// whole frames per painting; the rounding is carried over, so the total length stays exact
const count = files.length
let list = ''
let time = 0
let frames = 0
for (const [k, file] of files.entries()) {
	time += from + ((to - from) * k) / Math.max(1, count - 1)
	const end = Math.round(time * FPS)
	list += `file '${file}'\nduration ${(end - frames) / FPS}\n`
	frames = end
}
list += `file '${files.at(-1)}'\n` // the concat demuxer needs the last one again for its duration to count
const listFile = join(exports, 'list.txt')
writeFileSync(listFile, list)

const video = join(exports, `paintings-${from}-${to}.mp4`)
execFileSync(
	'ffmpeg',
	['-y', '-loglevel', 'error', '-f', 'concat', '-safe', '0', '-i', listFile, '-fps_mode', 'cfr', '-r', String(FPS), '-frames:v', String(frames)]
		.concat(['-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-crf', '18', '-movflags', '+faststart', video]),
	{ stdio: 'inherit' },
)
console.log(`${video}: ${count} paintings, ${(frames / FPS).toFixed(1)} s`)
