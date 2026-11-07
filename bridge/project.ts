// Capture projects: captures/projects/<name>/{raw/, paintings/, calibration.json, settings.json, stacks.json, out-of-stack.json}.
// The current project is remembered in captures/current-project.
import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const root = 'captures/projects'
const currentFile = 'captures/current-project'
const legacy = ['raw', 'paintings', 'calibration.json', 'settings.json']

// one-time migration: captures from before projects existed become the "test" project
if (!existsSync(root) && legacy.some((f) => existsSync(join('captures', f)))) {
	mkdirSync(join(root, 'test'), { recursive: true })
	for (const f of legacy) if (existsSync(join('captures', f))) renameSync(join('captures', f), join(root, 'test', f))
	writeFileSync(currentFile, 'test')
}

export const listProjects = () => (existsSync(root) ? readdirSync(root).sort() : [])

export function currentProject(): string | null {
	const name = existsSync(currentFile) ? readFileSync(currentFile, 'utf8').trim() : ''
	return name && existsSync(join(root, name)) ? name : null
}

export function projectPath(...parts: string[]) {
	const name = currentProject()
	if (!name) throw new Error('no project open — create or open one first')
	return join(root, name, ...parts)
}

export function openProject(name: string, create = false) {
	const clean = name.trim().replace(/[^\w.-]+/g, '-')
	if (!clean) throw new Error('invalid project name')
	if (!existsSync(join(root, clean))) {
		if (!create) throw new Error(`no project "${clean}"`)
		mkdirSync(join(root, clean), { recursive: true })
		writeFileSync(join(root, clean, 'stacks.json'), JSON.stringify([newStack('A')]))
	}
	writeFileSync(currentFile, clean)
	return clean
}

// physical stacks of paintings. The id is what paintings refer to and what gets synced; the name can be changed on the
// gallery's /admin and is kept here for working offline
export type Stack = { id: string; name: string }
const newStack = (name: string): Stack => ({ id: crypto.randomUUID(), name })

// stacks from when they were just a letter: the same id as in the gallery's migration (0006_group-ids.sql)
export const legacyStackId = (letter: string) => `00000000-0000-0000-0000-${Buffer.from(letter).toString('hex').padStart(12, '0')}`

const stacksFile = () => projectPath('stacks.json')
export const listStacks = (): Stack[] => {
	// from when they were called groups
	if (existsSync(projectPath('groups.json')) && !existsSync(stacksFile())) renameSync(projectPath('groups.json'), stacksFile())
	const stored: (string | Stack)[] = existsSync(stacksFile()) ? JSON.parse(readFileSync(stacksFile(), 'utf8')) : ['A']
	return stored.map((s) => (typeof s === 'string' ? { id: legacyStackId(s), name: s } : s))
}
const writeStacks = (stacks: Stack[]) => writeFileSync(stacksFile(), JSON.stringify(stacks, null, '\t'))

export function addStack(input: string) {
	const name = input?.trim()
	if (!name) throw new Error('a stack needs a name')
	const stacks = listStacks()
	if (stacks.some((s) => s.name === name)) throw new Error(`there already is a stack called "${name}"`)
	const stack = newStack(name)
	writeStacks([...stacks, stack])
	return stack
}

// adopt the names from the gallery
export function applyStackNames(names: Record<string, string>) {
	const stacks = listStacks()
	if (stacks.some((s) => names[s.id] && names[s.id] !== s.name)) writeStacks(stacks.map((s) => ({ ...s, name: names[s.id] ?? s.name })))
}

// paintings that no longer count in a stack: the gallery knows (taken out or deleted there), last known state kept here
const outFile = () => projectPath('out-of-stack.json')
export const listOutOfStack = (): string[] => (existsSync(outFile()) ? JSON.parse(readFileSync(outFile(), 'utf8')) : [])
export const setOutOfStack = (ids: string[]) => {
	if (ids.join() !== listOutOfStack().join()) writeFileSync(outFile(), JSON.stringify(ids, null, '\t'))
}
