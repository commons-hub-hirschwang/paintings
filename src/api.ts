import type { WebVariant } from '../shared/image-variants'
import type { Painting, PublicPainting } from '../shared/types'

export type { Painting, PublicPainting }

export const imageUrl = (painting: Pick<Painting, 'id' | 'variants_version'>, variant: WebVariant) =>
	`/img/${painting.id}/${variant}.jpg?v=${painting.variants_version}`

export const fetchPaintings = async (): Promise<PublicPainting[]> => (await fetch('/api/paintings')).json()

export async function fetchPainting(id: string): Promise<PublicPainting | null> {
	const response = await fetch(`/api/paintings/${id}`)
	return response.ok ? response.json() : null
}

export const formatPrice = (eur: number | null) => (eur ? `${eur.toLocaleString('de-AT')} €` : 'price on request')
