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
		writeFileSync(join(root, clean, 'groups.json'), JSON.stringify([newGroup('A')]))
	}
	writeFileSync(currentFile, clean)
	return clean
}

// groups = physical stacks. The id is what paintings refer to and what gets synced; the name can be changed on the
// gallery's /admin and is kept here for working offline
export type Group = { id: string; name: string }
const newGroup = (name: string): Group => ({ id: crypto.randomUUID(), name })

// groups from when they were just a letter: the same id as in the gallery's migration (0006_group-ids.sql)
export const legacyGroupId = (letter: string) => `00000000-0000-0000-0000-${Buffer.from(letter).toString('hex').padStart(12, '0')}`

const groupsFile = () => projectPath('groups.json')
export const listGroups = (): Group[] => {
	const stored: (string | Group)[] = existsSync(groupsFile()) ? JSON.parse(readFileSync(groupsFile(), 'utf8')) : ['A']
	return stored.map((g) => (typeof g === 'string' ? { id: legacyGroupId(g), name: g } : g))
}
const writeGroups = (groups: Group[]) => writeFileSync(groupsFile(), JSON.stringify(groups, null, '\t'))

export function addGroup(input: string) {
	const name = input?.trim()
	if (!name) throw new Error('a group needs a name')
	const groups = listGroups()
	if (groups.some((g) => g.name === name)) throw new Error(`there already is a group called "${name}"`)
	const group = newGroup(name)
	writeGroups([...groups, group])
	return group
}

// adopt the names from the gallery
export function applyGroupNames(names: Record<string, string>) {
	const groups = listGroups()
	if (groups.some((g) => names[g.id] && names[g.id] !== g.name)) writeGroups(groups.map((g) => ({ ...g, name: names[g.id] ?? g.name })))
}
