// Share previews: a painting's link, sent in a chat or posted, shows the painting with its name, size and price (Open
// Graph tags, read by WhatsApp, Signal, Telegram, Facebook, …). Those readers run no scripts, so the worker puts the
// tags into the page itself.
import { webVariants } from '../shared/image-variants'
import { formatPrice } from '../shared/pricing'
import { sizeLabel, type PublicPainting } from '../shared/types'

const escape = (text: string) => text.replace(/[&<>"]/g, (c) => `&${{ '&': 'amp', '<': 'lt', '>': 'gt', '"': 'quot' }[c]};`)

export function withPreview(page: Response, painting: PublicPainting, url: string) {
	let site = ''
	const title = painting.title || 'Untitled'
	const description = [sizeLabel(painting), painting.status === 'available' ? formatPrice(painting.price) : painting.status]
		.filter(Boolean)
		.join(' · ')
	// the normal variant: big enough for every preview, small enough to load quickly
	const image = new URL(`/img/${painting.id}/normal.jpg?v=${painting.variants_version}`, url).href
	const ratio = painting.width_cm && painting.height_cm ? painting.width_cm / painting.height_cm : 1
	const { maxSize } = webVariants.normal
	const [width, height] = ratio >= 1 ? [maxSize, Math.round(maxSize / ratio)] : [Math.round(maxSize * ratio), maxSize]
	const tags = () =>
		Object.entries({
			'og:type': 'website',
			'og:site_name': site,
			'og:title': title,
			'og:description': description,
			'og:url': url,
			'og:image': image,
			'og:image:width': `${width}`,
			'og:image:height': `${height}`,
			'og:image:alt': title,
			'twitter:card': 'summary_large_image',
		})
			.map(([key, value]) => `<meta ${key.startsWith('og:') ? 'property' : 'name'}="${key}" content="${escape(value)}">`)
			.join('\n')
	return new HTMLRewriter()
		.on('title', {
			text(chunk) {
				site += chunk.text
				if (chunk.lastInTextNode) chunk.replace(escape(`${title} – ${site}`), { html: true })
				else chunk.remove()
			},
		})
		.on('head', {
			element(head) {
				head.onEndTag((end) => {
					end.before(tags(), { html: true })
				})
			},
		})
		.transform(page)
}
