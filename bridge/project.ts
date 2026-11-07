// Capture projects: captures/projects/<name>/{raw/, paintings/, calibration.json, settings.json, stack-names.json}.
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
	}
	writeFileSync(currentFile, clean)
	return clean
}

// The stacks offered when capturing: last known names from the gallery, which owns them. A stack is just its name.
const namesFile = () => projectPath('stack-names.json')
export const knownStackNames = (): string[] => (existsSync(namesFile()) ? JSON.parse(readFileSync(namesFile(), 'utf8')) : [])
export const setKnownStackNames = (names: string[]) => {
	if (names.join('\0') !== knownStackNames().join('\0')) writeFileSync(namesFile(), JSON.stringify(names, null, '\t'))
}

// The name behind a stack id in painting.json files from when stacks had ids. Those files are read only, and kept.
export function oldStackName(id: string) {
	const file = ['stacks.json', 'groups.json'].map((name) => projectPath(name)).find((path) => existsSync(path))
	const stored: (string | { id: string; name: string })[] = file ? JSON.parse(readFileSync(file, 'utf8')) : ['A']
	for (const stack of stored) {
		if (typeof stack !== 'string' && stack.id === id) return stack.name
		// from when they were just a letter: the same id as in the gallery's migration (0006_group-ids.sql)
		if (typeof stack === 'string' && id === `00000000-0000-0000-0000-${Buffer.from(stack).toString('hex').padStart(12, '0')}`) return stack
	}
	throw new Error(`no name found for stack ${id}: nothing changed, please look at this project's stack files`)
}
