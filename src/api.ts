import type { WebVariant } from '../shared/image-variants'

export type Painting = {
	id: string
	title: string
	width_cm: number | null
	height_cm: number | null
	status: 'draft' | 'available' | 'reserved' | 'sold'
	variants_version: string
}

export const imageUrl = (painting: Painting, variant: WebVariant) =>
	`/img/${painting.id}/${variant}.jpg?v=${painting.variants_version}`

export const fetchPaintings = async (): Promise<Painting[]> => (await fetch('/api/paintings')).json()
