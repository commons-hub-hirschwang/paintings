<script setup lang="ts">
import { computed, onActivated, ref } from 'vue'
import { authed } from '@/auth'
import type { PaintingLogEntry } from '../../../shared/types'
import { act } from './state'

const entries = ref<PaintingLogEntry[]>([])
onActivated(() => act(async () => (entries.value = await authed<PaintingLogEntry[]>('/api/admin/log'))))

const NOBODY = 'unknown'
const who = (entry: PaintingLogEntry) => entry.actor ?? NOBODY
const paintingLabel = (entry: PaintingLogEntry) => [entry.stack, entry.number !== null ? `#${entry.number}` : '', entry.title || 'Untitled'].filter(Boolean).join(' ')
const fieldLabels: Record<string, string> = { title: 'name', width_cm: 'width', height_cm: 'height', number: '#', 'taken out': 'removed' }
const value = (v: string | number | null) => (v === null || v === '' ? 'empty' : v)

const whoFilter = ref<string | null>(null)
const fieldFilter = ref<string | null>(null)
const search = ref('')
const people = computed(() => [...new Set(entries.value.map(who))].sort())
const fields = computed(() => [...new Set(entries.value.map((e) => e.field))].sort())
const visible = computed(() =>
	entries.value.filter(
		(e) =>
			(whoFilter.value === null || who(e) === whoFilter.value) &&
			(fieldFilter.value === null || e.field === fieldFilter.value) &&
			paintingLabel(e).toLowerCase().includes(search.value.toLowerCase()),
	),
)
const date = (seconds: number) => new Date(seconds * 1000).toLocaleString()
</script>

<template>
	<section>
		<h2>Logs ({{ visible.length }})</h2>
		<div class="actions bulk">
			<label>
				Who
				<select v-model="whoFilter">
					<option :value="null">all</option>
					<option v-for="name in people" :key="name" :value="name">{{ name }}</option>
				</select>
			</label>
			<label>
				What
				<select v-model="fieldFilter">
					<option :value="null">all</option>
					<option v-for="field in fields" :key="field" :value="field">{{ fieldLabels[field] ?? field }}</option>
				</select>
			</label>
			<label>
				Painting
				<input v-model.trim="search" type="search" placeholder="A #3, name" />
			</label>
		</div>
		<table>
			<thead>
				<tr>
					<th>When</th>
					<th>Who</th>
					<th>Painting</th>
					<th>What</th>
					<th>From</th>
					<th>To</th>
				</tr>
			</thead>
			<tbody>
				<tr v-for="entry in visible" :key="entry.id">
					<td>{{ date(entry.created_at) }}</td>
					<td>{{ who(entry) }}</td>
					<td>{{ paintingLabel(entry) }}</td>
					<td>{{ fieldLabels[entry.field] ?? entry.field }}</td>
					<td>{{ entry.field === 'uploaded' ? '' : value(entry.old_value) }}</td>
					<td>{{ value(entry.new_value) }}</td>
				</tr>
			</tbody>
		</table>
	</section>
</template>
