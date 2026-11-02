import { ref } from 'vue'
import type { User } from '../shared/types'

export const user = ref<User | null | undefined>(undefined) // undefined: not loaded yet

export async function loadUser() {
	user.value = await (await fetch('/api/auth/me')).json()
}

export async function login(name: string, password: string) {
	const response = await fetch('/api/auth/login', {
		method: 'POST',
		headers: { 'content-type': 'application/json' },
		body: JSON.stringify({ name, password }),
	})
	const body = await response.json()
	if (!response.ok) throw new Error(body.error)
	user.value = body
}

export async function logout() {
	await fetch('/api/auth/logout', { method: 'POST' })
	user.value = null
}

// JSON call to a protected API; a 401 logs out locally so the login form shows up
export async function authed<T>(path: string, init: RequestInit = {}): Promise<T> {
	const response = await fetch(path, {
		...init,
		headers: init.body ? { 'content-type': 'application/json', ...init.headers } : init.headers,
	})
	const body = await response.json().catch(() => ({}))
	if (response.status === 401) user.value = null
	if (!response.ok) throw new Error(body.error ?? `${response.status}`)
	return body as T
}
