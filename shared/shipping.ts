// Shipping cost from the painting size, based on Österreichische Post rates (tariff sheet 1 July 2026):
//   Paket Österreich: ≤1 kg 6.61 · ≤2 kg 7.94 · ≤4 kg 9.25 · ≤10 kg 13.21 · ≤31.5 kg 21.13
//     standard up to 100×60×60 cm; longer up to 200 cm as Sperrgut (großes Sperrgut +20.00 / +24.00 over 10 kg)
//   Paket Plus International, zone 1b (neighbours; zone 1a/Germany is slightly cheaper):
//     ≤1 kg 19.01 · ≤2 kg 21.52 · ≤4 kg 25.29 · ≤10 kg 30.38 · ≤31.5 kg 83.40; max length 100 cm
// Package = painting + padding on every side; weight estimated from the area (frame, glass-free, cardboard).
// Plus a flat amount for packaging material. Larger paintings: pick-up only (or ask for a quote).

export const shipping = {
	pickup: { label: 'Pick-up in Austria (by arrangement)', eur: 0 },
	paddingCm: 10, // added to width and height (5 cm per side)
	packagingEur: 8,
	estimateKg: (areaM2: number) => 1.5 + 8 * areaM2,
	austria: {
		label: 'Shipping within Austria (Post)',
		maxLengthCm: 200,
		standard: { lengthCm: 100, otherCm: 60 },
		bulkyEur: (kg: number) => (kg <= 10 ? 20 : 24),
		rates: [
			{ kg: 1, eur: 6.61 },
			{ kg: 2, eur: 7.94 },
			{ kg: 4, eur: 9.25 },
			{ kg: 10, eur: 13.21 },
			{ kg: 31.5, eur: 21.13 },
		],
	},
	eu: {
		label: 'Shipping to the EU (Post)',
		maxLengthCm: 100,
		maxOtherCm: 60,
		rates: [
			{ kg: 1, eur: 19.01 },
			{ kg: 2, eur: 21.52 },
			{ kg: 4, eur: 25.29 },
			{ kg: 10, eur: 30.38 },
			{ kg: 31.5, eur: 83.4 },
		],
	},
	// Stripe can't price per country, so the buyer picks the matching option; addresses limited to these
	countries: ['AT', 'DE', 'IT', 'SI', 'HU', 'CZ', 'SK'],
} as const

export type ShippingOption = { label: string; eur: number }

const rate = (rates: readonly { kg: number; eur: number }[], kg: number) => rates.find((r) => kg <= r.kg)?.eur ?? null

// all options for a painting, pick-up first; whole euros, rounded up
export function shippingOptions(widthCm: number | null, heightCm: number | null): ShippingOption[] {
	const options: ShippingOption[] = [shipping.pickup]
	if (!widthCm || !heightCm) return options
	const long = Math.max(widthCm, heightCm) + shipping.paddingCm
	const short = Math.min(widthCm, heightCm) + shipping.paddingCm
	const kg = shipping.estimateKg((widthCm * heightCm) / 10_000)
	const total = (eur: number) => Math.ceil(eur + shipping.packagingEur)

	const { austria, eu } = shipping
	const domestic = rate(austria.rates, kg)
	if (domestic !== null && long <= austria.maxLengthCm) {
		const bulky = long > austria.standard.lengthCm || short > austria.standard.otherCm
		options.push({ label: austria.label, eur: total(domestic + (bulky ? austria.bulkyEur(kg) : 0)) })
	}
	const international = rate(eu.rates, kg)
	if (international !== null && long <= eu.maxLengthCm && short <= eu.maxOtherCm)
		options.push({ label: eu.label, eur: total(international) })
	return options
}
