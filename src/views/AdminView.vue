<script setup lang="ts">
import { ref, watch } from 'vue'
import LoginGate from '@/components/LoginGate.vue'
import { authed, user } from '@/auth'
import { imageUrl } from '@/api'
import { paintingStatuses, type AdminPainting, type PaintingStatus, type UploadKey } from '../../shared/types'

const paintings = ref<AdminPainting[]>([])
const keys = ref<UploadKey[]>([])
const keyName = ref('')
const newKey = ref<{ name: string; key: string } | null>(null)
const error = ref('')

async function load() {
	;[paintings.value, keys.value] = await Promise.all([
		authed<AdminPainting[]>('/api/admin/paintings'),
		authed<UploadKey[]>('/api/admin/keys'),
	])
}
watch(user, (u) => u?.role === 'admin' && load().catch((e) => (error.value = e.message)), { immediate: true })

async function act(task: () => Promise<unknown>) {
	error.value = ''
	try {
		await task()
		await load()
	} catch (e) {
		error.value = (e as Error).message
	}
}

const setStatus = (painting: AdminPainting, status: PaintingStatus) =>
	act(() => authed(`/api/admin/paintings/${painting.id}`, { method: 'PATCH', body: JSON.stringify({ status }) }))

const createKey = () =>
	act(async () => {
		newKey.value = await authed('/api/admin/keys', { method: 'POST', body: JSON.stringify({ name: keyName.value }) })
		keyName.value = ''
	})

const revokeKey = (key: UploadKey) => act(() => authed(`/api/admin/keys/${key.id}`, { method: 'DELETE' }))

const date = (seconds: number | null) => (seconds ? new Date(seconds * 1000).toLocaleString() : 'never')
</script>

<template>
	<main id="admin">
		<h1>Admin</h1>
		<LoginGate :roles="['admin']">
			<p v-if="error" class="error">{{ error }}</p>

			<section>
				<h2>Paintings ({{ paintings.length }})</h2>
				<table>
					<tr>
						<th></th>
						<th>Title</th>
						<th>Size (cm)</th>
						<th>Rating</th>
						<th>Status</th>
					</tr>
					<tr v-for="painting in paintings" :key="painting.id">
						<td>
							<img v-if="painting.variants_version" :src="imageUrl(painting, 'thumb')" :alt="painting.title" loading="lazy" />
						</td>
						<td>{{ painting.title || 'Untitled' }}</td>
						<td>{{ painting.width_cm }} × {{ painting.height_cm }}</td>
						<td>
							{{ painting.rating?.toFixed(1) ?? '–' }}
							<span class="muted">({{ painting.ratings }})</span>
						</td>
						<td>
							<select :value="painting.status" @change="setStatus(painting, ($event.target as HTMLSelectElement).value as PaintingStatus)">
								<option v-for="status in paintingStatuses" :key="status">{{ status }}</option>
							</select>
						</td>
					</tr>
				</table>
			</section>

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
					<tr v-for="key in keys" :key="key.id">
						<td>{{ key.name }}</td>
						<td class="muted">by {{ key.created_by }}, last used {{ date(key.last_used_at) }}</td>
						<td><button @click="revokeKey(key)">Revoke</button></td>
					</tr>
				</table>
			</section>
		</LoginGate>
	</main>
</template>

<style>
#admin {
	display: flex;
	flex-direction: column;
	gap: var(--gap);

	& section {
		display: flex;
		flex-direction: column;
		gap: var(--gap);
	}

	& table {
		border-collapse: collapse;

		& th {
			text-align: left;
		}

		& td,
		& th {
			padding: 0.3rem 0.6rem;
			border-bottom: 1px solid color-mix(in srgb, var(--muted) 30%, transparent);
		}

		& img {
			display: block;
			width: 4rem;
			height: 4rem;
			object-fit: contain;
		}
	}

	& code {
		user-select: all;
		word-break: break-all;
	}
}
</style>
