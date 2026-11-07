// A thread of bridge/pool.ts. tsx doesn't reach into worker threads, Node's own type stripping runs this: everything
// it imports needs the file extension and no TypeScript beyond types (remap.ts, lens.ts).
import { parentPort } from 'node:worker_threads'
import { remapRows, type RemapRows } from './remap.ts'

parentPort!.on('message', (rows: RemapRows) => {
	remapRows(rows)
	parentPort!.postMessage('done')
})
