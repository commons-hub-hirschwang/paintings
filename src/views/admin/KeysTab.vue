<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { authed } from '@/auth'
import type { UploadKey } from '../../../shared/types'
import { act } from './state'

const keys = ref<UploadKey[]>([])
const keyName = ref('')
const newKey = ref<{ name: string; key: string } | null>(null)

const loadKeys = async () => (keys.value = await authed<UploadKey[]>('/api/admin/keys'))
onMounted(() => act(loadKeys))

const createKey = () =>
	act(async () => {
		newKey.value = await authed('/api/admin/keys', { method: 'POST', body: JSON.stringify({ name: keyName.value }) })
		keyName.value = ''
		await loadKeys()
	})

const revokeKey = (key: UploadKey) =>
	act(async () => {
		await authed(`/api/admin/keys/${key.id}`, { method: 'DELETE' })
		await loadKeys()
	})

const date = (seconds: number | null) => (seconds ? new Date(seconds * 1000).toLocaleString() : 'never')
</script>

<template>
	<section>
		<h2>Upload keys</h2>
		<p class="muted">For capture laptops: paste a key into the capture screen's settings. Shown only once.</p>
		<p v-if="newKey" class="warning">
			Key "{{ newKey.name }}": <code>{{ newKey.key }}</code>
		</p>
		<form class="actions" @submit.prevent="createKey">
			<input v-model="keyName" placeholder="Name, e.g. attic laptop" required />
			<button type="submit">Create key</button>
		</form>
		<table>
			<tbody>
				<tr v-for="key in keys" :key="key.id">
					<td>{{ key.name }}</td>
					<td class="muted">by {{ key.created_by }}, last used {{ date(key.last_used_at) }}</td>
					<td><button @click="revokeKey(key)">Revoke</button></td>
				</tr>
			</tbody>
		</table>
	</section>
</template>
