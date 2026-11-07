// Resampling a photo pixel by pixel takes seconds in JavaScript. Here it is spread over worker threads: much faster, and
// the server stays responsive while paintings are rendered in the background. Same arithmetic, so the same pixels.
import { availableParallelism } from 'node:os'
import { Worker } from 'node:worker_threads'
import type { Mapping, RemapRows } from './remap'

// some cores stay free for sharp (JPEG encoding, decoding) and the server
const THREADS = Math.max(2, Math.min(8, availableParallelism() - 2))
const CHUNKS = THREADS * 4 // more chunks than threads: a capture and a render running at once take turns

type Job = { rows: RemapRows; done: () => void; failed: (error: Error) => void }
const waiting: Job[] = []
const idle = new Set<() => void>() // threads with nothing to do: calling one makes it take the next job
let started = false

function start() {
	const worker = new Worker(new URL('./remap-worker.ts', import.meta.url))
	let job: Job | undefined
	const next = () => {
		idle.delete(next)
		job = waiting.shift()
		if (job) {
			worker.ref()
			worker.postMessage(job.rows)
		} else {
			worker.unref() // an idle thread doesn't keep the process alive
			idle.add(next)
		}
	}
	worker.on('message', () => {
		job?.done()
		next()
	})
	// a thread that died is replaced; the image its chunk belonged to reports the error
	worker.on('error', (error) => {
		idle.delete(next)
		job?.failed(error)
		start()
	})
	next()
}

const shared = (data: Uint8Array) => {
	const copy = new SharedArrayBuffer(data.length)
	new Uint8Array(copy).set(data)
	return copy
}

// the width×height RGB image `mapping` makes of the source
export async function remap(source: { data: Uint8Array; width: number; height: number }, width: number, height: number, mapping: Mapping) {
	if (!started) {
		started = true
		for (let k = 0; k < THREADS; k++) start()
	}
	const src = shared(source.data)
	const out = new SharedArrayBuffer(width * height * 3)
	const count = Math.min(CHUNKS, height)
	const chunks: Promise<void>[] = []
	for (let k = 0; k < count; k++) {
		const rows = { src, sourceWidth: source.width, sourceHeight: source.height, out, width, height, fromRow: Math.floor((k * height) / count), toRow: Math.floor(((k + 1) * height) / count), mapping }
		chunks.push(
			new Promise((done, failed) => {
				waiting.push({ rows, done, failed })
				idle.values().next().value?.()
			}),
		)
	}
	await Promise.all(chunks)
	return Buffer.from(out)
}
