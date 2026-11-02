// Editable settings stored in D1 (table settings). Currently: the price formula.
import { defaultPriceFormula, priceFunction, type PriceFn } from '../shared/pricing'

export async function getPriceFormula(db: D1Database) {
	const row = await db.prepare(`SELECT value FROM settings WHERE key = 'price_formula'`).first<{ value: string }>()
	return row?.value ?? defaultPriceFormula
}

// a stored formula is validated on save; should it still fail, fall back to the default
export async function getPriceFunction(db: D1Database): Promise<PriceFn> {
	try {
		return priceFunction(await getPriceFormula(db))
	} catch {
		return priceFunction(defaultPriceFormula)
	}
}
