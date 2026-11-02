import type { WebVariant } from '../shared/image-variants'
import type { Painting } from '../shared/types'

export type { Painting }

export const imageUrl = (painting: Pick<Painting, 'id' | 'variants_version'>, variant: WebVariant) =>
	`/img/${painting.id}/${variant}.jpg?v=${painting.variants_version}`

export const fetchPaintings = async (): Promise<Painting[]> => (await fetch('/api/paintings')).json()
