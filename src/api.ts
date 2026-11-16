import { ref } from 'vue'
import type { WebVariant } from '../shared/image-variants'
import type { Painting, PublicPainting } from '../shared/types'

export type { Painting, PublicPainting }
export { formatPrice } from '../shared/pricing'

export const imageUrl = (painting: Pick<Painting, 'id' | 'variants_version'>, variant: WebVariant) =>
	`/img/${painting.id}/${variant}.jpg?v=${painting.variants_version}`

// public list, shared by gallery and painting view (prev/next): shown from memory right away, refreshed in the background
export const paintings = ref<PublicPainting[]>()
export async function loadPaintings() {
	paintings.value = await (await fetch('/api/paintings')).json()
}

