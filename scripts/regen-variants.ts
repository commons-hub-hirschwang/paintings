// Regenerate web variants from the archive masters after changing shared/image-variants.ts.
//   pnpm images:regen           outdated paintings only
//   pnpm images:regen --force   all paintings
import { api, getSettings } from '../bridge/api'
import { publishWebVariants } from '../bridge/images'
import { webVariantsVersion } from '../shared/image-variants'

const force = process.argv.includes('--force')
const paintings = (await (await api('/paintings')).json()) as { id: string; title: string; variants_version: string | null }[]
const todo = paintings.filter((p) => force || p.variants_version !== webVariantsVersion)
console.log(`${getSettings().galleryUrl}: ${todo.length} of ${paintings.length} paintings to regenerate (version ${webVariantsVersion})`)

for (const painting of todo) {
	const archive = await api(`/paintings/${painting.id}/images/archive`).catch(() => null)
	if (!archive) {
		console.warn(`  skipped ${painting.id} "${painting.title}": no archive image`)
		continue
	}
	await publishWebVariants(painting.id, Buffer.from(await archive.arrayBuffer()))
	console.log(`  ✓ ${painting.id} "${painting.title}"`)
}
