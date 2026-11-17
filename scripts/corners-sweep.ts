// Compares parameter sets of the automatic corners (bridge/detect.ts params) on both cases of scripts/corners-eval.ts:
//   npx tsx scripts/corners-sweep.ts [--jobs 6] [--trials report.json] "countMin=10" "countMin=10 edgeRanking=1" …
// Per set: one shot on all captures (within 20 px), and the one-placed-corner trials starting from the one shots in
// --trials (default captures/corner-eval-all/baseline.json: a fixed set of trials), for its paintings with a corner > 80 px
// off. "" is the defaults. Reports land in captures/corner-sweep/<n>-{one-shot,trials}/.
import { spawnSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const BIG = 80
const arg = (name: string, fallback: string) => {
	const i = process.argv.indexOf(`--${name}`)
	return i >= 0 ? process.argv[i + 1]! : fallback
}
const jobs = arg('jobs', '6')
const trialsFrom = arg('trials', 'captures/corner-eval-all/baseline.json')
const flags = new Set(['--jobs', '--trials'])
const sets = process.argv.slice(2).filter((a, i, all) => !flags.has(a) && !flags.has(all[i - 1]!))

type Report = { id: string; tolerance: number[]; oneShot: { errors: number[] | null; ms: number }; corrections: { errors: number[] }[] }
const big = (JSON.parse(readFileSync(trialsFrom, 'utf8')) as (Report & { quads: { oneShot: unknown } })[])
	.filter((r) => !r.oneShot.errors || Math.max(...r.oneShot.errors) > BIG)
	.map((r) => r.id)

function run(set: string, out: string, extra: string[]): Report[] {
	const args = ['tsx', 'scripts/corners-eval.ts', '--jobs', jobs, '--out', out, ...extra, ...set.split(/\s+/).filter(Boolean).flatMap((s) => ['--set', s])]
	const result = spawnSync('npx', args, { stdio: ['ignore', 'ignore', 'inherit'] })
	if (result.status !== 0) throw new Error(`eval failed for "${set}"`)
	return JSON.parse(readFileSync(join(out, 'report.json'), 'utf8'))
}

const ok = (errors: number[] | null, tolerance: number[]) => !!errors && errors.every((e, k) => e <= tolerance[k]!)
const rows: string[] = []
for (const [i, set] of sets.entries()) {
	const oneShot = run(set, join('captures', 'corner-sweep', `${i}-one-shot`), ['--count', '100000', '--one-shot'])
	const trials = run(set, join('captures', 'corner-sweep', `${i}-trials`), ['--only', big.join(','), '--from', trialsFrom])
	const all = trials.flatMap((r) => r.corrections.map((t) => ok(t.errors, r.tolerance)))
	const seconds = oneShot.reduce((s, r) => s + r.oneShot.ms, 0) / oneShot.length / 1000
	const failed = oneShot.filter((r) => !ok(r.oneShot.errors, r.tolerance)).map((r) => r.id.slice(0, 4))
	const row = `${(set || '(defaults)').padEnd(60)} one shot ${oneShot.filter((r) => ok(r.oneShot.errors, r.tolerance)).length}/${oneShot.length}  trials ${all.filter(Boolean).length}/${all.length}  paintings ${trials.filter((r) => r.corrections.length && r.corrections.every((t) => ok(t.errors, r.tolerance))).length}/${trials.filter((r) => r.corrections.length).length}  ${seconds.toFixed(1)}s  off: ${failed.join(' ')}`
	console.log(row)
	rows.push(row)
}
