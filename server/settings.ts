// Editable settings stored in D1 (table settings): the price formula, the Stripe setup (server/stripe.ts).
import { defaultPriceFormula, priceFunction, type PriceFn } from '../shared/pricing'

export async function getSetting(db: D1Database, key: string) {
	const row = await db.prepare(`SELECT value FROM settings WHERE key = ?`).bind(key).first<{ value: string }>()
	return row?.value ?? null
}

export async function putSetting(db: D1Database, key: string, value: string, user: string) {
	await db
		.prepare(
			`INSERT INTO settings (key, value, updated_by) VALUES (?, ?, ?)
			 ON CONFLICT (key) DO UPDATE SET value = excluded.value, updated_by = excluded.updated_by, updated_at = unixepoch()`,
		)
		.bind(key, value, user)
		.run()
}

export async function deleteSettings(db: D1Database, keys: string[]) {
	await db.prepare(`DELETE FROM settings WHERE key IN (${keys.map(() => '?').join(', ')})`).bind(...keys).run()
}

export const getPriceFormula = async (db: D1Database) => (await getSetting(db, 'price_formula')) ?? defaultPriceFormula

// a stored formula is validated on save; should it still fail, fall back to the default
export async function getPriceFunction(db: D1Database): Promise<PriceFn> {
	try {
		return priceFunction(await getPriceFormula(db))
	} catch {
		return priceFunction(defaultPriceFormula)
	}
}
