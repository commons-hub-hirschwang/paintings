<script setup lang="ts">
// Shows the slot for logged-in users with one of `roles`, otherwise a login form.
import { ref } from 'vue'
import { login, user } from '@/auth'
import type { Role } from '../../shared/types'

const props = defineProps<{ roles: Role[] }>()
const name = ref('')
const password = ref('')
const error = ref('')

async function submit() {
	error.value = ''
	try {
		await login(name.value.trim(), password.value)
		password.value = ''
	} catch (e) {
		error.value = (e as Error).message
	}
}
</script>

<template>
	<p v-if="user === undefined" class="muted">Loading…</p>
	<slot v-else-if="user && props.roles.includes(user.role)" />
	<form v-else id="login" @submit.prevent="submit">
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

<style>
#login {
	display: flex;
	flex-direction: column;
	gap: var(--gap);
	max-width: 20rem;
}
</style>
