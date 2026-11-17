// Checklist of captures whose stored corners need a look: per painting in scripts/corners-truth.json with a `check`,
// a link into the capture app (bridge on 5174), a thumbnail (stored corners green, the ones to check circled) and what
// to check; {k} in `check` becomes the corner's position in the photo ("the top-left corner").
//   npx tsx scripts/corners-checklist.ts [--project hirschwangerhof-v2] [--out captures/corner-checklist]
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import sharp from 'sharp'
import type { LocalPainting } from '../bridge/store'
import type { Point, Quad } from '../shared/geometry'

const arg = (name: string, fallback: string) => {
	const i = process.argv.indexOf(`--${name}`)
	return i >= 0 ? process.argv[i + 1]! : fallback
}
const project = arg('project', 'hirschwangerhof-v2')
const out = arg('out', join('captures', 'corner-checklist'))
const projectDir = join('captures', 'projects', project)
const WIDTH = 480

type Correction = { check?: string; note?: string }
const corrections: Record<string, Correction> = JSON.parse(await readFile(join('scripts', 'corners-truth.json'), 'utf8'))
await mkdir(out, { recursive: true })

function position(quad: Quad, k: number) {
	const center = { x: quad.reduce((s, p) => s + p.x, 0) / 4, y: quad.reduce((s, p) => s + p.y, 0) / 4 }
	const p = quad[k]!
	return `the ${p.y < center.y ? 'top' : 'bottom'}-${p.x < center.x ? 'left' : 'right'} corner`
}

const items: string[] = []
for (const [id, correction] of Object.entries(corrections)) {
	if (!correction.check) continue
	const painting: LocalPainting = JSON.parse(await readFile(join(projectDir, 'paintings', id, 'painting.json'), 'utf8'))
	const original = painting.original!
	const quad = original.quad.map((c) => ({ x: c.x + original.crop.left, y: c.y + original.crop.top })) as Quad
	const marked = [...correction.check.matchAll(/\{(\d)\}/g)].map((m) => Number(m[1]))
	const check = correction.check.replace(/\{(\d)\}/g, (_, k) => position(quad, Number(k))).replace(/^the/, 'The')
	const file = join(projectDir, 'corrected', `${original.photo}.jpg`)
	const { width, height } = await sharp(file).rotate().metadata().then((m) => (m.orientation && m.orientation >= 5 ? { width: m.height!, height: m.width! } : { width: m.width!, height: m.height! }))
	const s = WIDTH / width
	const at = (p: Point) => `${(p.x * s).toFixed(1)},${(p.y * s).toFixed(1)}`
	const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${WIDTH}" height="${Math.round(height * s)}">
		<polygon points="${quad.map(at).join(' ')}" fill="none" stroke="#0f0" stroke-width="2"/>
		${marked.map((k) => `<circle cx="${quad[k]!.x * s}" cy="${quad[k]!.y * s}" r="14" fill="none" stroke="#f0f" stroke-width="3"/>`).join('')}
	</svg>`
	const thumb = `${id}.jpg`
	const base = await sharp(file).rotate().resize({ width: WIDTH }).toBuffer()
	await sharp(base).composite([{ input: Buffer.from(svg) }]).jpeg({ quality: 80 }).toFile(join(out, thumb))
	const url = `http://localhost:5174/${project}/p/${id}`
	const name = [painting.title, painting.stack].filter(Boolean).join(' · ') || id.slice(0, 8)
	items.push(`<li data-id="${id}"><a href="${url}" target="capture"><img src="${thumb}"></a><div><h2><label><input type="checkbox"> <a href="${url}" target="capture">${name}</a></label></h2><p>${check}</p><small>${id}</small></div></li>`)
}

await writeFile(
	join(out, 'index.html'),
	`<!doctype html><meta charset="utf-8"><title>Corner checklist</title>
<style>
body { font-family: sans-serif; background: #222; color: #eee; margin: 16px; max-width: 1000px }
a { color: #8cf }
ul { list-style: none; padding: 0; display: grid; gap: 24px;
	li { display: flex; gap: 16px; flex-wrap: wrap; img { width: ${WIDTH}px; max-width: 100% } h2 { margin: 0 0 8px } small { color: #999 } }
	li:has(:checked) { opacity: 0.4 } }
</style>
<p>${items.length} captures to check. Stored corners green, the ones to check circled; positions as in the photo. Tick one when done.</p>
<ul>${items.join('')}</ul>
<script>
const key = 'corner-checklist'
const boxes = [...document.querySelectorAll('li')].map((li) => [li.dataset.id, li.querySelector('input')])
try { const done = JSON.parse(localStorage.getItem(key) ?? '[]'); for (const [id, box] of boxes) box.checked = done.includes(id) } catch {}
document.addEventListener('change', () => { try { localStorage.setItem(key, JSON.stringify(boxes.filter(([, b]) => b.checked).map(([id]) => id))) } catch {} })
</script>`,
)
console.log(join(out, 'index.html'))
