// draft and private don't show in the gallery
export type PaintingStatus = 'draft' | 'private' | 'available' | 'reserved' | 'sold'
export const paintingStatuses: PaintingStatus[] = ['draft', 'private', 'available', 'reserved', 'sold']

export type Painting = {
	id: string
	title: string
	width_cm: number | null
	height_cm: number | null
	status: PaintingStatus
	variants_version: string | null
	created_at: number
	// stack (just a name) + # identify a painting: "Keller #3". Assigned by the gallery at upload; the # only changes when
	// the painting changes stack. Null: from before stacks, and hidden from the public
	stack: string | null
	number: number | null
	// e.g. "Leinwand", "Öl auf Leinwand" (set at capture)
	material: string | null
}

// "≈ 100 × 75 cm · Leinwand" (sizes are measured from the photo)
export const sizeLabel = (p: Pick<Painting, 'width_cm' | 'height_cm' | 'material'>) =>
	[p.width_cm !== null && p.height_cm !== null ? `≈ ${p.width_cm} × ${p.height_cm} cm` : '', p.material ?? '']
		.filter(Boolean)
		.join(' · ')

export const stackLabel = (p: Pick<Painting, 'stack' | 'number'>) =>
	p.stack !== null && p.number !== null ? `${p.stack} #${p.number}` : ''

// rater: rates; author: rates and names paintings; admin: everything
export type Role = 'admin' | 'author' | 'rater'
export const canName = (role: Role | undefined) => role === 'admin' || role === 'author'
export type User = { name: string; role: Role }

// public: with computed price (rating itself stays private)
export type PublicPainting = Painting & { price: number | null }
// admin list: with averaged aesthetic rating and price, and where to look in the physical stack (null: not in it)
export type AdminPainting = PublicPainting & { rating: number | null; ratings: number; deleted_at: number | null; taken_out_at: number | null; stack_index: number | null }
// rating list: with the current user's score
export type RatePainting = Painting & { my_score: number | null }

export type UploadKey = { id: string; name: string; created_by: string; created_at: number; last_used_at: number | null }

// one changed field of a painting (actor null: not changed through the app), with the painting as it is now
export type PaintingLogEntry = {
	id: number
	painting_id: string
	actor: string | null
	field: string
	old_value: string | number | null
	new_value: string | number | null
	created_at: number
	title: string | null
	stack: string | null
	number: number | null
}
