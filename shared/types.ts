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
	// physical stack and position in it, e.g. group "A", number 3 → "A #3"
	group_name: string | null
	number: number | null
}

export const stackLabel = (p: Pick<Painting, 'group_name' | 'number'>) =>
	p.group_name !== null && p.number !== null ? `${p.group_name} #${p.number}` : ''

// rater: rates; author: rates and names paintings; admin: everything
export type Role = 'admin' | 'author' | 'rater'
export const canName = (role: Role | undefined) => role === 'admin' || role === 'author'
export type User = { name: string; role: Role }

// public: with computed price (rating itself stays private)
export type PublicPainting = Painting & { price: number | null }
// admin list: with averaged aesthetic rating and price
export type AdminPainting = PublicPainting & { rating: number | null; ratings: number }
// rating list: with the current user's score
export type RatePainting = Painting & { my_score: number | null }

export type UploadKey = { id: string; name: string; created_by: string; created_at: number; last_used_at: number | null }
