<script setup lang="ts">
// view of the website users; admins switch others between author and rater. New users, passwords and admin rights:
// pnpm user:* (scripts/users.ts)
import { onMounted, ref } from 'vue'
import { authed } from '@/auth'
import { assignableRoles, type Role, type UserEntry } from '../../../shared/types'
import { act } from './state'

const users = ref<UserEntry[]>([])

const loadUsers = async () => (users.value = await authed<UserEntry[]>('/api/admin/users'))
onMounted(() => act(loadUsers))

const setRole = (user: UserEntry, role: Role) =>
	act(async () => {
		await authed(`/api/admin/users/${encodeURIComponent(user.name)}/role`, { method: 'PUT', body: JSON.stringify({ role }) })
		await loadUsers()
	})

const date = (seconds: number | null) => (seconds ? new Date(seconds * 1000).toLocaleDateString() : '')
</script>

<template>
	<section>
		<h2>Users</h2>
		<p class="muted">
			New users, forgotten passwords and admin rights: <code>pnpm user:add</code>, <code>user:reset</code>, <code>user:role</code>
			(see README).
		</p>
		<table>
			<tbody>
				<tr v-for="user in users" :key="user.name">
					<td>{{ user.name }}</td>
					<td>
						<select
							v-if="!user.legacy && user.role !== 'admin'"
							:value="user.role"
							@change="setRole(user, ($event.target as HTMLSelectElement).value as Role)"
						>
							<option v-for="role in assignableRoles" :key="role">{{ role }}</option>
						</select>
						<template v-else>{{ user.role }}</template>
					</td>
					<td class="muted">
						<template v-if="user.legacy">old login, chooses a new password at the next login</template>
						<template v-else-if="user.must_change">one-time password not used yet</template>
						<template v-else>since {{ date(user.created_at) }}</template>
					</td>
				</tr>
			</tbody>
		</table>
	</section>
</template>
