// Shipping options at checkout. PLACEHOLDER prices — research carrier rates (Austria/EU) and edit here.
// Tiers by width + height of the painting (cm, without packaging); larger paintings: pick-up only.
export const shipping = {
	pickup: { label: 'Pick-up in Austria (by arrangement)', eur: 0 },
	tiers: [
		{ maxSumCm: 100, label: 'Parcel (small)', eur: 15 },
		{ maxSumCm: 160, label: 'Parcel (medium)', eur: 30 },
		{ maxSumCm: 240, label: 'Bulky parcel', eur: 60 },
	],
	countries: ['AT', 'DE', 'CH', 'IT', 'SI', 'HU', 'CZ', 'SK'],
} as const

export function shippingTier(widthCm: number | null, heightCm: number | null) {
	if (!widthCm || !heightCm) return null
	return shipping.tiers.find((tier) => widthCm + heightCm <= tier.maxSumCm) ?? null
}
