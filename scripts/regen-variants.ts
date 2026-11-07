// Regenerate web variants from the archive masters on this laptop after changing shared/image-variants.ts.
//   pnpm images:regen           outdated paintings only
//   pnpm images:regen --force   all paintings
// Of the current project: the masters are only here. Paintings in the gallery from elsewhere are reported.
import { existsSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { api, getSettings } from '../bridge/api'
import { publishWebVariants } from '../bridge/images'
import { paintingFile } from '../bridge/store'
import { webVariantsVersion } from '../shared/image-variants'

const force = process.argv.includes('--force')
const paintings = (await (await api('/paintings')).json()) as { id: string; title: string; variants_version: string | null }[]
const todo = paintings.filter((p) => force || p.variants_version?.split('-')[0] !== webVariantsVersion)
console.log(`${getSettings().galleryUrl}: ${todo.length} of ${paintings.length} paintings to regenerate (version ${webVariantsVersion})`)

for (const painting of todo) {
	const archive = paintingFile(painting.id, 'archive.jpg')
	if (!existsSync(archive)) {
		console.warn(`  skipped ${painting.id} "${painting.title}": no archive image in this project`)
		continue
	}
	await publishWebVariants(painting.id, await readFile(archive))
	console.log(`  ✓ ${painting.id} "${painting.title}"`)
}
