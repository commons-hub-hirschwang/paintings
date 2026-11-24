<script setup lang="ts">
// Shows the slot for logged-in users with one of `roles`, otherwise a login form. After a one-time (or legacy) password,
// a new one is chosen before the session starts.
import { ref } from 'vue'
import { login, user } from '@/auth'
import PasswordForm from './PasswordForm.vue'
import type { Role } from '../../shared/types'

const props = defineProps<{ roles: Role[] }>()
const name = ref('')
const password = ref('')
const error = ref('')
const mustChange = ref(false)

async function submit() {
	error.value = ''
	try {
		mustChange.value = (await login(name.value.trim(), password.value)) === 'mustChange'
		if (!mustChange.value) password.value = ''
	} catch (e) {
		error.value = (e as Error).message
	}
}

function changed() {
	mustChange.value = false
	password.value = ''
}
</script>

<template>
	<p v-if="user === undefined" class="muted">Loading…</p>
	<slot v-else-if="user && props.roles.includes(user.role)" />
	<template v-else-if="mustChange">
		<p>Welcome, {{ name.trim() }}. Please choose your own password.</p>
		<PasswordForm :name="name.trim()" :password="password" @done="changed" />
	</template>
	<form v-else class="form" @submit.prevent="submit">
		<p v-if="user" class="error">Logged in as {{ user.name }}, but this page needs another role.</p>
		<label>
			Name
			<input v-model="name" autocomplete="username" required />
		</label>
		<label>
			Password
			<input v-model="password" type="password" autocomplete="current-password" />
		</label>
		<button type="submit">Log in</button>
		<p v-if="error" class="error">{{ error }}</p>
	</form>
</template>
