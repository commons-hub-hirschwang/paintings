<script setup lang="ts">
// A new password for `name`. Asks for the current one unless it is given (right after logging in with a one-time password).
import { ref } from 'vue'
import { changePassword } from '@/auth'
import { minPasswordLength } from '../../shared/password'

const props = defineProps<{ name: string; password?: string }>()
const emit = defineEmits<{ done: [] }>()
const current = ref('')
const next = ref('')
const repeat = ref('')
const error = ref('')

async function submit() {
	error.value = ''
	if (next.value !== repeat.value) return (error.value = 'the two new passwords differ')
	try {
		await changePassword(props.name, props.password ?? current.value, next.value)
		emit('done')
	} catch (e) {
		error.value = (e as Error).message
	}
}
</script>

<template>
	<form class="form" @submit.prevent="submit">
		<!-- for password managers: whose password this is -->
		<input :value="name" autocomplete="username" hidden />
		<label v-if="props.password === undefined">
			Current password
			<input v-model="current" type="password" autocomplete="current-password" required />
		</label>
		<label>
			New password
			<input v-model="next" type="password" autocomplete="new-password" :minlength="minPasswordLength" required />
		</label>
		<label>
			New password again
			<input v-model="repeat" type="password" autocomplete="new-password" required />
		</label>
		<button type="submit">Save password</button>
		<p v-if="error" class="error">{{ error }}</p>
	</form>
</template>
