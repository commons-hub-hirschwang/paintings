// Website users (table users, server/auth.ts), on the deployment (--env commons) unless --local:
//   pnpm user:add <name> [admin|author|rater] [password]   without a password: prints a one-time password, the user
//                                                          chooses their own when logging in
//   pnpm user:reset <name>    a new one-time password (forgotten password)
//   pnpm user:role <name> <admin|author|rater>
//   pnpm user:remove <name>
//   pnpm user:list            (users still in the legacy USERS secret are not listed)
import { execFileSync } from 'node:child_process'
import { randomInt } from 'node:crypto'
import { hashPassword, minPasswordLength } from '../shared/password'

const args = process.argv.slice(2)
const local = args.includes('--local')
const [command, name, ...rest] = args.filter((a) => a !== '--local')
const roles = ['admin', 'author', 'rater']

function fail(message: string): never {
	console.error(message)
	process.exit(1)
}

function sql(statement: string): Record<string, unknown>[] {
	const target = local ? ['--local'] : ['--remote', '--env', 'commons']
	try {
		const out = execFileSync('pnpm', ['-s', 'wrangler', 'd1', 'execute', 'DB', ...target, '--json', '--command', statement], {
			encoding: 'utf8',
			env: { ...process.env, CLOUDFLARE_ACCOUNT_ID: '05cb64c47a8cb62832b428eb832bea0c' },
			stdio: ['ignore', 'pipe', 'inherit'],
		})
		return JSON.parse(out)[0]?.results ?? []
	} catch (e) {
		// wrangler --json puts its error on stdout
		let message = String((e as { stdout?: string }).stdout || e)
		try {
			const { error } = JSON.parse(message)
			message = [error.text, ...(error.notes ?? []).map((n: { text: string }) => n.text)].join('\n')
		} catch {}
		if (message.includes('no such table: users')) message += `\n→ not deployed yet: ${local ? 'pnpm db:migrate' : 'pnpm run deploy'}`
		fail(message)
	}
}

// names and roles end up in the SQL: keep them plain (hashes are hex and digits)
const checkName = () => (name && /^[\w.@-]+$/.test(name) ? name : fail('name: letters, digits, . _ @ - only'))
const checkRole = (role: string | undefined) => (role && roles.includes(role) ? role : fail(`role: ${roles.join(', ')}`))
const exists = () => sql(`SELECT 1 FROM users WHERE name = '${name}'`).length > 0

// easy to type and to read out: no 0/o, 1/l/i
function oneTimePassword() {
	const letters = 'abcdefghjkmnpqrstuvwxyz23456789'
	const group = () => Array.from({ length: 4 }, () => letters[randomInt(letters.length)]).join('')
	return `${group()}-${group()}`
}

async function setPassword(password: string | undefined, role?: string) {
	const chosen = password ?? oneTimePassword()
	const hash = await hashPassword(chosen)
	const mustChange = password ? 0 : 1
	if (role) sql(`INSERT INTO users (name, password_hash, role, must_change) VALUES ('${name}', '${hash}', '${role}', ${mustChange})`)
	else sql(`UPDATE users SET password_hash = '${hash}', must_change = ${mustChange} WHERE name = '${name}'`)
	console.log(password ? `${name}: password set` : `${name}: one-time password ${chosen} (a new one is chosen when logging in)`)
}

if (command === 'add') {
	checkName()
	const [role = 'rater', password] = rest
	checkRole(role)
	if (password !== undefined && password.length < minPasswordLength) fail(`password: at least ${minPasswordLength} characters`)
	if (exists()) fail(`${name} exists already (pnpm user:reset ${name} for a new password)`)
	await setPassword(password, role)
} else if (command === 'reset') {
	checkName()
	if (!exists()) fail(`no user ${name}`)
	await setPassword(undefined)
} else if (command === 'role') {
	checkName()
	if (!exists()) fail(`no user ${name}`)
	sql(`UPDATE users SET role = '${checkRole(rest[0])}' WHERE name = '${name}'`)
	console.log(`${name}: ${rest[0]}`)
} else if (command === 'remove') {
	checkName()
	if (!exists()) fail(`no user ${name}`)
	sql(`DELETE FROM users WHERE name = '${name}'`)
	console.log(`${name} removed`)
} else if (command === 'list') {
	console.table(sql(`SELECT name, role, must_change AS "one-time password", datetime(created_at, 'unixepoch') AS created FROM users ORDER BY name`))
	console.log('(users still in the legacy USERS secret are not listed)')
} else
	fail(
		'usage: pnpm user:add <name> [admin|author|rater] [password] | user:reset <name> | user:role <name> <role> | user:remove <name> | user:list   [--local]',
	)
