// Review sheet for scripts/corners-eval.ts results: per painting an overview and the 4 corners zoomed in,
// stored corners green, detection red (one shot) — to check whether the detection or the stored corners are off.
//   npx tsx scripts/corners-review.ts <report.json> <out dir> <n> [n…]   (n: painting number in the report)
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import sharp from 'sharp'
import type { Point, Quad } from '../shared/geometry'

const [reportFile, out, ...numbers] = process.argv.slice(2)
const project = 'hirschwangerhof-v2'
const report = JSON.parse(await readFile(reportFile!, 'utf8'))
await mkdir(out!, { recursive: true })

const ZOOM = 240 // px of the photo around a corner
const SHOWN = 360

function aligned(quad: Quad, reference: Quad): Quad {
	const rotations = [0, 1, 2, 3].map((r) => quad.map((_, i) => quad[(i + r) % 4]!) as Quad)
	const spread = (q: Quad) => q.reduce((s, p, k) => s + Math.hypot(p.x - reference[k]!.x, p.y - reference[k]!.y), 0)
	return rotations.reduce((a, b) => (spread(b) < spread(a) ? b : a))
}

const cards: string[] = []
for (const n of numbers.map(Number)) {
	const r = report.find((r: { n: number }) => r.n === n)
	if (!r) continue
	const file = join('captures', 'projects', project, 'corrected', `${r.photo}.jpg`)
	const image = sharp(file).rotate()
	const { width, height } = await image.metadata().then((m) => ({ width: m.width!, height: m.height! }))
	const truth: Quad = r.quads.truth
	const detected: Quad | null = r.quads.oneShot && aligned(r.quads.oneShot, truth)
	// overview: whole photo, 1200 px wide
	const s = 1200 / width
	const pts = (q: Quad, f: (p: Point) => Point) => q.map((p) => f(p)).map((p) => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' ')
	const overview = (p: Point) => ({ x: p.x * s, y: p.y * s })
	const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="${Math.round(height * s)}">
		<polygon points="${pts(truth, overview)}" fill="none" stroke="#0f0" stroke-width="2"/>
		${detected ? `<polygon points="${pts(detected, overview)}" fill="none" stroke="#f00" stroke-width="2" stroke-dasharray="8 4"/>` : ''}
		${truth.map((p, k) => `<text x="${p.x * s + 6}" y="${p.y * s - 6}" font-size="22" fill="#fff" stroke="#000" stroke-width="0.8">${k}</text>`).join('')}
	</svg>`
	const base = await sharp(file).rotate().resize({ width: 1200 }).toBuffer()
	await sharp(base).composite([{ input: Buffer.from(svg) }]).jpeg({ quality: 82 }).toFile(join(out!, `${n}.jpg`))
	// corners: around the stored corner, both drawn as crosses and the sides leading away
	const zooms: string[] = []
	for (const [k, corner] of truth.entries()) {
		const left = Math.round(Math.min(Math.max(0, corner.x - ZOOM / 2), width - ZOOM))
		const top = Math.round(Math.min(Math.max(0, corner.y - ZOOM / 2), height - ZOOM))
		const z = SHOWN / ZOOM
		const local = (p: Point) => ({ x: (p.x - left) * z, y: (p.y - top) * z })
		const cross = (p: Point, color: string) => {
			const c = local(p)
			return `<path d="M${c.x - 12},${c.y}h24M${c.x},${c.y - 12}v24" stroke="${color}" stroke-width="2"/>`
		}
		const lines = (q: Quad, color: string, dash = '') => {
			const prev = q[(k + 3) % 4]!
			const next = q[(k + 1) % 4]!
			return `<polyline points="${pts([prev, q[k]!, next, next] as Quad, local)}" fill="none" stroke="${color}" stroke-width="1.5" ${dash}/>`
		}
		const zsvg = `<svg xmlns="http://www.w3.org/2000/svg" width="${SHOWN}" height="${SHOWN}">
			${lines(truth, '#0f0')}${cross(corner, '#0f0')}
			${detected ? lines(detected, '#f00', 'stroke-dasharray="6 3"') + cross(detected[k]!, '#f00') : ''}
		</svg>`
		const crop = await sharp(file).rotate().extract({ left, top, width: ZOOM, height: ZOOM }).resize({ width: SHOWN }).toBuffer()
		await sharp(crop).composite([{ input: Buffer.from(zsvg) }]).jpeg({ quality: 85 }).toFile(join(out!, `${n}-c${k}.jpg`))
		const error = r.oneShot.errors?.[k]
		zooms.push(`<figure><img src="${n}-c${k}.jpg"><figcaption>corner ${k}: ${error === undefined ? '—' : `${error.toFixed(1)} px off`}</figcaption></figure>`)
	}
	cards.push(`<section><h2>#${n} <small>${r.id}</small></h2><img class="overview" src="${n}.jpg"><div class="zooms">${zooms.join('')}</div></section>`)
}

await writeFile(
	join(out!, 'index.html'),
	`<!doctype html><meta charset="utf-8"><title>Corner review</title>
<style>body{font-family:sans-serif;background:#222;color:#eee;margin:16px} section{margin-bottom:48px} .overview{max-width:100%} .zooms{display:flex;gap:8px;flex-wrap:wrap} figure{margin:0} small{color:#999;font-weight:normal}</style>
<p>green: stored corners · red dashed: automatic detection (one shot)</p>${cards.join('')}`,
)
console.log(join(out!, 'index.html'))
