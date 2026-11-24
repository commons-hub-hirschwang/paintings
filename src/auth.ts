import { ref } from 'vue'
import type { User } from '../shared/types'

export const user = ref<User | null | undefined>(undefined) // undefined: not loaded yet

export async function loadUser() {
	user.value = await (await fetch('/api/auth/me')).json()
}

async function post(path: string, data: object) {
	const response = await fetch(path, {
		method: 'POST',
		headers: { 'content-type': 'application/json' },
		body: JSON.stringify(data),
	})
	const body = await response.json()
	if (!response.ok) throw new Error(body.error)
	return body
}

// 'mustChange': right password, but a new one has to be chosen first (one-time or legacy password): changePassword
export async function login(name: string, password: string): Promise<'mustChange' | void> {
	const body = await post('/api/auth/login', { name, password })
	if (body.mustChange) return 'mustChange'
	user.value = body
}

export async function changePassword(name: string, password: string, newPassword: string) {
	user.value = await post('/api/auth/password', { name, password, newPassword })
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
