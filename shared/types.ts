export type PaintingStatus = 'draft' | 'available' | 'reserved' | 'sold'
export const paintingStatuses: PaintingStatus[] = ['draft', 'available', 'reserved', 'sold']

export type Painting = {
	id: string
	title: string
	width_cm: number | null
	height_cm: number | null
	status: PaintingStatus
	variants_version: string | null
	created_at: number
}

export type Role = 'admin' | 'rater'
export type User = { name: string; role: Role }

// public: with computed price (rating itself stays private)
export type PublicPainting = Painting & { price: number | null }
// admin list: with averaged aesthetic rating and price
export type AdminPainting = PublicPainting & { rating: number | null; ratings: number }
// rating list: with the current user's score
export type RatePainting = Painting & { my_score: number | null }

export type UploadKey = { id: string; name: string; created_by: string; created_at: number; last_used_at: number | null }
