// A painting's position in its physical stack: how many paintings before it are still there. Deleted paintings don't
// count, they were bad captures. Null: not in a stack (taken out, deleted, or from before stacks). Query alias: p.
export const stackIndexSql = `CASE WHEN p.taken_out_at IS NULL AND p.deleted_at IS NULL AND p.stack_order IS NOT NULL THEN (
	SELECT COUNT(*) FROM paintings q
	WHERE q.stack_id = p.stack_id AND q.taken_out_at IS NULL AND q.deleted_at IS NULL AND (q.stack_order, q.id) < (p.stack_order, p.id)
) END AS stack_index`
