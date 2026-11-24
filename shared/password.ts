// Password hashes for the users table, the same in the Worker and in scripts/users.ts (Web Crypto in both):
// "pbkdf2:<iterations>:<salt hex>:<hash hex>". 100 000 iterations is the most Workers allow.
const iterations = 100_000
const hex = (bytes: ArrayBuffer | Uint8Array) => [...new Uint8Array(bytes)].map((b) => b.toString(16).padStart(2, '0')).join('')
const unhex = (text: string) => new Uint8Array((text.match(/../g) ?? []).map((pair) => parseInt(pair, 16)))

async function derive(password: string, salt: Uint8Array<ArrayBuffer>, rounds: number) {
	const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(password), 'PBKDF2', false, ['deriveBits'])
	return hex(await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations: rounds }, key, 256))
}

export async function hashPassword(password: string) {
	const salt = crypto.getRandomValues(new Uint8Array(16))
	return `pbkdf2:${iterations}:${hex(salt)}:${await derive(password, salt, iterations)}`
}

export async function verifyPassword(password: string, stored: string) {
	const [scheme, rounds, salt, hash] = stored.split(':')
	return scheme === 'pbkdf2' && !!salt && (await derive(password, unhex(salt), Number(rounds))) === hash
}

export const minPasswordLength = 8
