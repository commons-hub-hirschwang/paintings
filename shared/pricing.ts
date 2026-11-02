// Price = formula over size and averaged aesthetic rating. The formula is edited on /admin (stored in D1);
// this default applies until someone saves one. Language: shared/expr.ts.
//   600 €/m² for a painting rated 5; area^0.8: large paintings cost more, but less than proportionally;
//   rating^1.5: better paintings gain more than linearly; at least 80 €; rounded to 10 €.
// Results are always rounded to whole euros; no rating (or no size) → no price ("price on request").
import { compile } from './expr'

export const defaultPriceFormula = 'max(80, round(600 * area_m2^0.8 * (rating / 5)^1.5, 10))'
export const priceVariables = ['width_cm', 'height_cm', 'area_m2', 'rating'] as const

export type PriceFn = (widthCm: number | null, heightCm: number | null, rating: number | null) => number | null

// throws FormulaError for invalid formulas
export function priceFunction(formula: string): PriceFn {
	const run = compile(formula, priceVariables)
	return (widthCm, heightCm, rating) => {
		if (!widthCm || !heightCm || rating === null) return null
		const value = run({ width_cm: widthCm, height_cm: heightCm, area_m2: (widthCm * heightCm) / 10_000, rating })
		return Number.isFinite(value) && value > 0 ? Math.round(value) : null
	}
}

// examples shown next to the formula on /admin
export const priceExamples = [
	{ widthCm: 30, heightCm: 40, rating: 5 },
	{ widthCm: 60, heightCm: 80, rating: 5 },
	{ widthCm: 60, heightCm: 80, rating: 8 },
	{ widthCm: 100, heightCm: 120, rating: 7 },
]
