// Capture projects: captures/projects/<name>/{raw/, paintings/, calibration.json, settings.json}.
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
