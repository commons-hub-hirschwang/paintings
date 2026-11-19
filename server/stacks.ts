// Stacks are just names on paintings. Query fragments and rules shared by the routes.

// where to look in the physical stack: how many paintings below this one (lower position) are still there. Admin only; what
// identifies a painting is stack + number, the order is position (migration 0013). Null: not in the stack. Query alias: p.
export const stackIndexSql = `CASE WHEN p.taken_out_at IS NULL AND p.deleted_at IS NULL AND p.position IS NOT NULL THEN (
	SELECT COUNT(*) FROM paintings q
	WHERE q.stack = p.stack AND q.taken_out_at IS NULL AND q.deleted_at IS NULL AND q.position < p.position
) END AS stack_index`

// the next # of a stack, the top. Taken-out and deleted paintings keep theirs, so it is never reused. Bound: the stack
export const nextNumberSql = `(SELECT COALESCE(MAX(q.number), -1) + 1 FROM paintings q WHERE q.stack = ?)`
// the top of a stack's order. Bound: the stack
export const topPositionSql = `(SELECT COALESCE(MAX(q.position), -1) + 1 FROM paintings q WHERE q.stack = ?)`

export const cleanStackName = (input: unknown) => {
	const name = typeof input === 'string' ? input.trim() : ''
	return name && name.length <= 100 ? name : null
}
