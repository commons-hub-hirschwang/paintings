// Measure the average colour of paintings that have web images but no colour yet (uploaded before colours were stored),
// from their thumb in the gallery. Any project: needs no archive images.
//   pnpm images:colors
import { api, getSettings } from '../bridge/api'
import { averageColor } from '../bridge/images'

const { galleryUrl } = getSettings()
const paintings = (await (await api('/paintings')).json()) as { id: string; title: string; variants_version: string | null; color: string | null }[]
const todo = paintings.filter((p) => p.variants_version && !p.color)
console.log(`${galleryUrl}: ${todo.length} of ${paintings.length} paintings without colour`)

for (const painting of todo) {
	const response = await fetch(`${galleryUrl}/img/${painting.id}/thumb.jpg?v=${painting.variants_version}`)
	if (!response.ok) {
		console.warn(`  skipped ${painting.id} "${painting.title}": thumb ${response.status}`)
		continue
	}
	const color = await averageColor(Buffer.from(await response.arrayBuffer()))
	await api(`/paintings/${painting.id}/color`, { method: 'PUT', body: JSON.stringify({ color }), headers: { 'content-type': 'application/json' } })
	console.log(`  ✓ ${painting.id} "${painting.title}" ${color}`)
}
