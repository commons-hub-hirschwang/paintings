<script setup lang="ts">
import { ref } from 'vue'
import { authed } from '@/auth'
import type { Status } from '../../../shared/types'
import { act, statuses } from './state'

const newName = ref('')
const newPublic = ref(false)
const add = () =>
	act(async () => {
		await authed('/api/admin/statuses', { method: 'POST', body: JSON.stringify({ name: newName.value, public: newPublic.value }) })
		newName.value = ''
		newPublic.value = false
	})

const change = (status: Status, update: { public?: boolean; name?: string }) =>
	act(() => authed(`/api/admin/statuses/${encodeURIComponent(status.name)}`, { method: 'PATCH', body: JSON.stringify(update) }))

const renaming = ref<{ status: Status; name: string } | null>(null)
const rename = () =>
	act(async () => {
		await change(renaming.value!.status, { name: renaming.value!.name })
		renaming.value = null
	})

const remove = (status: Status) => act(() => authed(`/api/admin/statuses/${encodeURIComponent(status.name)}`, { method: 'DELETE' }))
</script>

<template>
	<section>
		<h2>Statuses</h2>
		<p class="muted">
			Public: paintings with this status are shown in the gallery. Built-in statuses are used by uploads and the shop: they keep
			their name. A status can be removed once no painting has it.
		</p>
		<form class="actions" @submit.prevent="add">
			<input v-model="newName" placeholder="New status, e.g. on loan" required />
			<label class="check">
				<input v-model="newPublic" type="checkbox" class="pick" />
				Public
			</label>
			<button type="submit">Add status</button>
		</form>
		<table>
			<thead>
				<tr>
					<th>Status</th>
					<th class="narrow">Public</th>
					<th class="narrow">Paintings</th>
					<th></th>
				</tr>
			</thead>
			<tbody>
				<tr v-for="status in statuses" :key="status.name">
					<td>
						<form v-if="renaming?.status.name === status.name" class="sentence" @submit.prevent="rename">
							<input v-model.trim="renaming.name" aria-label="New name" required />
							<button type="submit" :disabled="!renaming.name">Rename</button>
							<button type="button" @click="renaming = null">Cancel</button>
						</form>
						<template v-else>
							{{ status.name }} <span v-if="status.built_in" class="muted">(built in)</span>
						</template>
					</td>
					<td class="narrow">
						<input type="checkbox" class="pick" :checked="status.public" @change="change(status, { public: ($event.target as HTMLInputElement).checked })" />
					</td>
					<td class="narrow">{{ status.paintings }}</td>
					<td>
						<div v-if="!status.built_in" class="actions">
							<button @click="renaming = { status, name: status.name }">Rename</button>
							<button :disabled="status.paintings > 0" :title="status.paintings ? 'Give its paintings another status first' : ''" @click="remove(status)">
								Remove
							</button>
						</div>
					</td>
				</tr>
			</tbody>
		</table>
	</section>
</template>
