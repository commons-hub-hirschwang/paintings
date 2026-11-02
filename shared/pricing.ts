// Price = aesthetic factor × size factor. Edit the numbers here; prices update on the next deploy.
//   price = eurPerM2 × area^areaExponent × (rating / 5)^ratingExponent, at least `minimum`, rounded to `roundTo`
// areaExponent < 1: large paintings cost more, but less than proportionally to their area.
export const pricing = {
	eurPerM2: 600, // a 1 m² painting rated 5
	areaExponent: 0.8,
	ratingExponent: 1.5,
	minimum: 80,
	roundTo: 10,
} as const

export function price(widthCm: number | null, heightCm: number | null, rating: number | null): number | null {
	if (!widthCm || !heightCm || rating === null) return null
	const areaM2 = (widthCm * heightCm) / 10_000
	const raw = pricing.eurPerM2 * areaM2 ** pricing.areaExponent * (rating / 5) ** pricing.ratingExponent
	return Math.max(pricing.minimum, Math.round(raw / pricing.roundTo) * pricing.roundTo)
}
