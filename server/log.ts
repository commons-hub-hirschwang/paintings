// Changes to paintings are logged by database triggers (migration 0009). They only need to know who is acting: a batch is
// one transaction, so naming the actor in it can't get mixed up with another request.
export async function changePaintings(db: D1Database, actor: string, ...changes: D1PreparedStatement[]) {
	const results = await db.batch([db.prepare(`UPDATE current_actor SET name = ?`).bind(actor), ...changes, db.prepare(`UPDATE current_actor SET name = NULL`)])
	return results.slice(1, -1)
}
