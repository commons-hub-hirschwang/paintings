// Evaluates the automatic corners (bridge/detect.ts) against the corners stored with captured paintings.
//   pnpm corners:eval [--project hirschwangerhof-v2] [--count 30] [--out dir] [--jobs 8] [--only id,id]
// Two cases per painting, in capture order (the previous painting's corners are the hint, as in the bridge):
//  1. one shot: detectCorners → largest corner error against the stored corners
//  2. one correction (paintings with a corner off by more than BIG after one shot): per such corner, a trial: the hand
//     places it --click px (default 30) from its stored position, the snap runs with it held (bridge/server.ts /detect).
//     A trial succeeds when all 4 corners are within THRESHOLD afterwards: one placed corner should be enough.
// Writes <out>/report.json and, for every painting off after one shot, <out>/<n>-<id>.jpg: stored corners green,
// one shot red, after the first trial blue (the placed corner circled).
// --explain: per miss, whether the truth was no candidate or scored lower (slow). --one-shot: case 1 only. --set name=value: bridge/detect.ts params. --only id,id: just these paintings.
import { existsSync, rmSync } from 'node:fs'
import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises'
import { spawn } from 'node:child_process'
import { join } from 'node:path'
import sharp from 'sharp'
import { detectCorners, explainDetection, explainSnap, params, snapCorners, type Explanation } from '../bridge/detect'
import type { LocalPainting } from '../bridge/store'
import type { Point, Quad } from '../shared/geometry'

const THRESHOLD = 20 // px: a corner further off counts as wrong
const BIG = 80 // px: a corner this far off is one the hand corrects

const arg = (name: string, fallback: string) => {
	const i = process.argv.indexOf(`--${name}`)
	return i >= 0 ? process.argv[i + 1]! : fallback
}
const project = arg('project', 'hirschwangerhof-v2')
const count = Number(arg('count', '30'))
const out = arg('out', join('captures', 'corner-eval'))
const jobs = Number(arg('jobs', '8'))
const only = arg('only', '').split(',').filter(Boolean)
const shard = arg('shard', '') // "i/n": a child process doing every n-th painting
const oneShotOnly = process.argv.includes('--one-shot')
const explaining = process.argv.includes('--explain')
const click = Number(arg('click', '30')) // px: where the hand puts a corner, off its true position
// --from report.json: the corrections start from that report's one shot (a fixed set of trials while the one shot changes)
const from = arg('from', '')
// --set name=value (repeatable): overrides bridge/detect.ts params; lists comma separated
const sets = process.argv.flatMap((a, i) => (a === '--set' ? [process.argv[i + 1]!] : []))
for (const set of sets) {
	const [name, value] = set.split('=') as [keyof typeof params, string]
	if (!name || value === undefined) throw new Error(`--set needs name=value, got "${set}"`)
	if (!(name in params)) throw new Error(`no param "${name}": ${Object.keys(params).join(', ')}`)
	;(params as Record<string, unknown>)[name] = Array.isArray(params[name]) ? value.split(',').map(Number) : Number(value)
}

const projectDir = join('captures', 'projects', project)

type Case = { n: number; id: string; photo: string; truth: Quad; hint: Quad | null }
type Result = {
	n: number
	id: string
	photo: string
	error?: string
	oneShot: { errors: number[] | null; ms: number; why?: string }
	// per trial: the corner placed by hand (index into truth), errors after the snap
	corrections: { corner: number; placed: Point; quad: Quad; errors: number[]; unsnapped: number; ms: number; why?: string }[]
	quads: { truth: Quad; oneShot: Quad | null; corrected: Quad | null }
}

async function cases(): Promise<Case[]> {
	const dir = join(projectDir, 'paintings')
	const paintings: LocalPainting[] = []
	for (const id of await readdir(dir)) {
		const file = join(dir, id, 'painting.json')
		if (existsSync(file)) paintings.push(JSON.parse(await readFile(file, 'utf8')))
	}
	const usable = paintings
		.filter((p) => p.original && existsSync(join(projectDir, 'corrected', `${p.original.photo}.jpg`)))
		.sort((a, b) => a.createdAt - b.createdAt)
	const all = usable.map((p, i): Case => {
		const full = (q: LocalPainting) => q.original!.quad.map((c) => ({ x: c.x + q.original!.crop.left, y: c.y + q.original!.crop.top })) as Quad
		return { n: i, id: p.id, photo: p.original!.photo, truth: full(p), hint: i > 0 ? full(usable[i - 1]!) : null }
	})
	return only.length ? all.filter((c) => only.some((o) => c.id.startsWith(o))) : all.slice(-count)
}

// the quad's corners in the order of `reference`'s (nearest of the 4 rotations)
function aligned(quad: Quad, reference: Quad): Quad {
	const rotations = [0, 1, 2, 3].map((r) => quad.map((_, i) => quad[(i + r) % 4]!) as Quad)
	const spread = (q: Quad) => q.reduce((s, p, k) => s + Math.hypot(p.x - reference[k]!.x, p.y - reference[k]!.y), 0)
	return rotations.reduce((a, b) => (spread(b) < spread(a) ? b : a))
}
// the truth scoring higher than the winner: it was no candidate (nearest: how near the candidates came); lower: the score
// prefers something else; null: the truth doesn't refine to itself (no clear edge along a side, or bowed)
const verdict = (e: Explanation) =>
	!e.truth || e.truth.distance > THRESHOLD
		? `truth not refinable (nearest candidate ${e.nearest.toFixed(0)}px)`
		: e.truth.score > (e.winner?.score ?? -Infinity)
			? `no candidate: truth ${e.truth.score.toFixed(2)} > winner ${e.winner?.score.toFixed(2)}, nearest candidate ${e.nearest.toFixed(0)}px`
			: `scoring: winner ${e.winner!.score.toFixed(2)} ≥ truth ${e.truth.score.toFixed(2)}`
const errorsOf = (quad: Quad, truth: Quad) => aligned(quad, truth).map((p, k) => Math.hypot(p.x - truth[k]!.x, p.y - truth[k]!.y))

async function evaluate(c: Case): Promise<Result> {
	const file = join(projectDir, 'corrected', `${c.photo}.jpg`)
	const started = performance.now()
	const detection = await detectCorners(file, c.hint)
	const ms = performance.now() - started
	const result: Result = {
		n: c.n,
		id: c.id,
		photo: c.photo,
		oneShot: { errors: detection && errorsOf(detection.quad, c.truth), ms },
		corrections: [],
		quads: { truth: c.truth, oneShot: detection?.quad ?? null, corrected: null },
	}
	const off = (errors: number[] | null) => !errors || Math.max(...errors) > THRESHOLD
	if (explaining && off(result.oneShot.errors)) result.oneShot.why = verdict(await explainDetection(file, c.truth, c.hint))
	if (oneShotOnly) return result
	const start: Quad | null = from ? (JSON.parse(await readFile(from, 'utf8')) as Result[]).find((r) => r.id === c.id)?.quads.oneShot ?? null : (detection?.quad ?? null)
	if (!start) return result
	const shown = aligned(start, c.truth)
	for (const [corner, error] of errorsOf(shown, c.truth).entries()) {
		if (error <= BIG) continue
		// the hand puts it about where it belongs: `click` px off, in a direction differing per painting and corner
		const angle = (c.n * 2.4 + corner * 1.7) % (2 * Math.PI)
		const placed = shown.map((p, i) => (i === corner ? { x: c.truth[i]!.x + click * Math.cos(angle), y: c.truth[i]!.y + click * Math.sin(angle) } : p)) as Quad
		const started = performance.now()
		const snapped = await snapCorners(file, placed, placed.map((_, i) => i === corner))
		const after = aligned(snapped.detection.quad, c.truth)
		const errors = errorsOf(after, c.truth)
		const why = explaining && off(errors) ? verdict(await explainSnap(file, placed, placed.map((_, i) => i === corner), c.truth)) : undefined
		result.corrections.push({ corner, placed: placed[corner]!, quad: after, errors, unsnapped: snapped.unsnapped, ms: performance.now() - started, why })
		result.quads.corrected ??= after
	}
	return result
}

// stored corners green, one shot red, after the first trial blue; around the painting, 1600 px wide
async function overlay(r: Result, path: string) {
	const file = join(projectDir, 'corrected', `${r.photo}.jpg`)
	const { width, height } = await sharp(file).rotate().metadata().then((m) => (m.orientation && m.orientation >= 5 ? { width: m.height!, height: m.width! } : { width: m.width!, height: m.height! }))
	const xs = r.quads.truth.map((p) => p.x)
	const ys = r.quads.truth.map((p) => p.y)
	const margin = 150
	const left = Math.max(0, Math.floor(Math.min(...xs) - margin))
	const top = Math.max(0, Math.floor(Math.min(...ys) - margin))
	const crop = { left, top, width: Math.min(width, Math.ceil(Math.max(...xs) + margin)) - left, height: Math.min(height, Math.ceil(Math.max(...ys) + margin)) - top }
	const s = 1600 / crop.width
	const pts = (q: Quad) => q.map((p) => `${((p.x - left) * s).toFixed(1)},${((p.y - top) * s).toFixed(1)}`).join(' ')
	const poly = (q: Quad | null, color: string, dash = '') => (q ? `<polygon points="${pts(q)}" fill="none" stroke="${color}" stroke-width="2" ${dash}/>` : '')
	const dragged = r.corrections[0] && r.quads.truth[r.corrections[0].corner]!
	const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1600" height="${Math.round(crop.height * s)}">
		${poly(r.quads.truth, '#0f0')}${poly(r.quads.oneShot, '#f00', 'stroke-dasharray="8 4"')}${poly(r.quads.corrected, '#08f', 'stroke-dasharray="3 3"')}
		${dragged ? `<circle cx="${(dragged.x - left) * s}" cy="${(dragged.y - top) * s}" r="14" fill="none" stroke="#08f" stroke-width="3"/>` : ''}
		<text x="10" y="30" font-size="24" fill="#fff" stroke="#000" stroke-width="0.6">#${r.n} one shot ${r.oneShot.errors?.map((e) => e.toFixed(0)).join('/') ?? '—'} · corrected ${r.corrections[0]?.errors.map((e) => e.toFixed(0)).join('/') ?? '—'}</text>
	</svg>`
	const base = await sharp(file).rotate().extract(crop).resize({ width: 1600 }).toBuffer()
	await sharp(base).composite([{ input: Buffer.from(svg) }]).jpeg({ quality: 80 }).toFile(path)
}

const fmt = (errors: number[] | null | undefined) => (errors ? `max ${Math.max(...errors).toFixed(1).padStart(6)}  [${errors.map((e) => e.toFixed(1)).join(', ')}]` : '— nothing —')

if (shard) {
	const [i, n] = shard.split('/').map(Number) as [number, number]
	const mine = (await cases()).filter((_, k) => k % n === i)
	const results: Result[] = []
	for (const c of mine)
		results.push(
			await evaluate(c).catch((error): Result => ({
				n: c.n, id: c.id, photo: c.photo, error: String(error?.stack ?? error), oneShot: { errors: null, ms: 0 }, corrections: [],
				quads: { truth: c.truth, oneShot: null, corrected: null },
			})),
		)
	await writeFile(arg('result', ''), JSON.stringify(results))
} else {
	const all = await cases()
	await mkdir(out, { recursive: true })
	console.log(`${project}: ${all.length} paintings, ${jobs} jobs`)
	const shards = await Promise.all(
		Array.from({ length: Math.min(jobs, all.length) }, (_, i) =>
			new Promise<Result[]>((resolve, reject) => {
				const result = join(out, `.shard-${i}.json`)
				rmSync(result, { force: true }) // never an earlier run's
				const args = ['tsx', 'scripts/corners-eval.ts', '--project', project, '--count', String(count), '--shard', `${i}/${Math.min(jobs, all.length)}`, '--result', result]
				if (only.length) args.push('--only', only.join(','))
				if (oneShotOnly) args.push('--one-shot')
				if (from) args.push('--from', from)
				if (explaining) args.push('--explain')
				for (const set of sets) args.push('--set', set)
				const child = spawn('npx', args, { stdio: ['ignore', 'inherit', 'inherit'] })
				child.on('close', async (code, signal) => (code === 0 && existsSync(result) ? resolve(JSON.parse(await readFile(result, 'utf8'))) : reject(new Error(`shard ${i} failed: ${code ?? signal}`))))
			}),
		),
	)
	const results = shards.flat().sort((a, b) => a.n - b.n)
	await mkdir(out, { recursive: true })
	await writeFile(join(out, 'report.json'), JSON.stringify(results, null, '\t'))
	for (const r of results) {
		if (r.error) console.log(`#${String(r.n).padStart(3)} ${r.id.slice(0, 8)} ERROR ${r.error}`)
		const off = !r.oneShot.errors || Math.max(...r.oneShot.errors) > THRESHOLD
		console.log(`#${String(r.n).padStart(3)} ${r.id.slice(0, 8)} ${off ? '✗' : '✓'} one shot ${fmt(r.oneShot.errors)}  ${(r.oneShot.ms / 1000).toFixed(1)}s${r.oneShot.why ? `  — ${r.oneShot.why}` : ''}`)
		for (const [k, c] of r.corrections.entries()) console.log(`       ${Math.max(...c.errors) <= THRESHOLD ? '✓' : '✗'} corner ${c.corner} placed${c.unsnapped ? ' (unsnapped)' : ''}: ${fmt(c.errors)}  ${(c.ms / 1000).toFixed(1)}s${c.why ? `  — ${c.why}` : ''}`)
		if (off) await overlay(r, join(out, `${String(r.n).padStart(3, '0')}-${r.id.slice(0, 8)}.jpg`))
	}
	const oneShotOk = results.filter((r) => r.oneShot.errors && Math.max(...r.oneShot.errors) <= THRESHOLD)
	const ok = oneShotOk.length
	const trials = results.flatMap((r) => r.corrections)
	const fixed = trials.filter((t) => Math.max(...t.errors) <= THRESHOLD).length
	const paintingsFixed = results.filter((r) => r.corrections.length && r.corrections.every((t) => Math.max(...t.errors) <= THRESHOLD)).length
	const median = (v: number[]) => v.sort((a, b) => a - b)[Math.floor(v.length / 2)] ?? NaN
	const good = oneShotOk.map((r) => Math.max(...r.oneShot.errors!))
	const seconds = results.map((r) => r.oneShot.ms / 1000)
	console.log(`\none shot within ${THRESHOLD}px: ${ok}/${results.length} (median max error of those ${median(good).toFixed(1)}px), mean ${(seconds.reduce((a, b) => a + b, 0) / seconds.length).toFixed(1)}s per photo`)
	if (!oneShotOnly)
		console.log(
			`one placed corner (${click}px off) enough: ${fixed}/${trials.length} trials; paintings fixed whichever corner is placed: ${paintingsFixed}/${results.filter((r) => r.corrections.length).length}`,
		)
	console.log(`overlays + report: ${out}`)
}
