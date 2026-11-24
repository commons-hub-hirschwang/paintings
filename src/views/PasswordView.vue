<script setup lang="ts">
import { ref } from 'vue'
import LoginGate from '@/components/LoginGate.vue'
import PasswordForm from '@/components/PasswordForm.vue'
import { user } from '@/auth'

const saved = ref(false)
</script>

<template>
	<main>
		<LoginGate :roles="['admin', 'author', 'rater']">
			<h1>Change password</h1>
			<p v-if="saved">Saved.</p>
			<PasswordForm v-else :name="user!.name" @done="saved = true" />
		</LoginGate>
	</main>
</template>
