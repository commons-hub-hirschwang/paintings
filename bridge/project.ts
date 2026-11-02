// Capture projects: captures/projects/<name>/{raw/, paintings/, calibration.json, settings.json, groups.json}.
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
		writeFileSync(join(root, clean, 'groups.json'), JSON.stringify(['A']))
	}
	writeFileSync(currentFile, clean)
	return clean
}

// groups = physical stacks: A, B, C, …, Z, AA, AB, … (one default group per project)
const groupsFile = () => projectPath('groups.json')
export const listGroups = (): string[] => (existsSync(groupsFile()) ? JSON.parse(readFileSync(groupsFile(), 'utf8')) : ['A'])

const letters = (n: number): string => (n < 26 ? '' : letters(Math.floor(n / 26) - 1)) + String.fromCharCode(65 + (n % 26))

export function addGroup() {
	const groups = listGroups()
	let n = groups.length
	while (groups.includes(letters(n))) n++
	const group = letters(n)
	writeFileSync(groupsFile(), JSON.stringify([...groups, group]))
	return group
}
