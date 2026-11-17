// The statuses configured on /admin (table statuses, migration 0012). The built-in ones have behaviour in code.
import { builtInStatuses, type Status } from '../shared/types'

export const statusExists = async (db: D1Database, name: unknown) =>
	typeof name === 'string' && !!(await db.prepare(`SELECT 1 FROM statuses WHERE name = ?`).bind(name).first())

export const cleanStatusName = (input: unknown) => {
	const name = typeof input === 'string' ? input.trim().replace(/\s+/g, ' ') : ''
	return name && name.length <= 50 ? name : null
}

// with how many paintings have each, deleted ones included (a status can only be removed once none has it)
export async function listStatuses(db: D1Database): Promise<Status[]> {
	const { results } = await db
		.prepare(`SELECT s.name, s.public, (SELECT COUNT(*) FROM paintings p WHERE p.status = s.name) AS paintings FROM statuses s ORDER BY s.position`)
		.all<{ name: string; public: number; paintings: number }>()
	return results.map((s) => ({ ...s, public: !!s.public, built_in: builtInStatuses.includes(s.name) }))
}
