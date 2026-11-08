<script setup lang="ts">
import { computed, ref } from 'vue'
import { authed } from '@/auth'
import { imageUrl } from '@/api'
import { paintingStatuses, sizeLabel, type AdminPainting, type PaintingStatus } from '../../../shared/types'
import { act, changed, eur, namedStacks, paintings, priceOf } from './state'

const rename = (painting: AdminPainting, title: string) =>
	act(() => authed(`/api/rate/paintings/${painting.id}/title`, { method: 'PUT', body: JSON.stringify({ title }) }))

const setRemoved = (painting: AdminPainting, out: boolean) =>
	act(() => authed('/api/admin/paintings/taken-out', { method: 'PUT', body: JSON.stringify({ ids: [painting.id], out }) }))

const setStatus = (painting: AdminPainting, status: PaintingStatus) =>
	act(() => authed(`/api/admin/paintings/${painting.id}`, { method: 'PATCH', body: JSON.stringify({ status }) }))

// filters (null = all); deleted paintings only show up on request
const stackFilter = ref<string | null>(null)
const numberFilter = ref('')
const statusFilter = ref<PaintingStatus | null>(null)
const placeFilter = ref<'in stack' | 'removed' | null>(null)
const showDeleted = ref(false)
// the stacks in the list ('' = paintings without one); the admin list is sorted by stack and #
const stacks = computed(() => [...new Set(paintings.value.map((p) => p.stack ?? ''))])
const visible = computed(() =>
	paintings.value.filter(
		(p) =>
			(stackFilter.value === null || (p.stack ?? '') === stackFilter.value) &&
			(numberFilter.value === '' || String(p.number) === numberFilter.value) &&
			(statusFilter.value === null || p.status === statusFilter.value) &&
			(placeFilter.value === null || (placeFilter.value === 'removed') === (p.taken_out_at !== null)) &&
			(showDeleted.value || p.deleted_at === null),
	),
)

// selection (checkboxes on the right) → status of all selected at once; only ever acts on what the filters show
const selected = ref(new Set<string>())
const pickedPaintings = computed(() => visible.value.filter((p) => selected.value.has(p.id)))
const picked = computed(() => pickedPaintings.value.map((p) => p.id))
// the buttons follow the selection, and act on the paintings they apply to
const pickedActive = computed(() => pickedPaintings.value.filter((p) => p.deleted_at === null))
const pickedInStack = computed(() => pickedActive.value.filter((p) => p.taken_out_at === null))
const pickedRemoved = computed(() => pickedActive.value.filter((p) => p.taken_out_at !== null))
const pickedDeleted = computed(() => pickedPaintings.value.filter((p) => p.deleted_at !== null))
const idsOf = (list: AdminPainting[]) => list.map((p) => p.id)
const allSelected = computed(() => visible.value.length > 0 && picked.value.length === visible.value.length)
function toggle(id: string) {
	const next = new Set(selected.value)
	if (!next.delete(id)) next.add(id)
	selected.value = next
}
const toggleAll = () => (selected.value = new Set(allSelected.value ? [] : visible.value.map((p) => p.id)))
const setSelectedStatus = (status: PaintingStatus) =>
	act(async () => {
		await authed('/api/admin/paintings', { method: 'PATCH', body: JSON.stringify({ ids: picked.value, status }) })
		selected.value = new Set()
	})
const setSelectedDeleted = (deleted: boolean) =>
	act(async () => {
		const ids = idsOf(deleted ? pickedActive.value : pickedDeleted.value)
		await authed('/api/admin/paintings/deleted', { method: 'PUT', body: JSON.stringify({ ids, deleted }) })
		selected.value = new Set()
	})

const setSelectedTakenOut = (out: boolean, onTop = false) =>
	act(async () => {
		const ids = idsOf(out ? pickedInStack.value : pickedRemoved.value)
		await authed('/api/admin/paintings/taken-out', { method: 'PUT', body: JSON.stringify({ ids, out, onTop }) })
		selected.value = new Set()
	})

const moveTo = ref('')
const moveSelected = () =>
	act(async () => {
		await authed('/api/admin/paintings/stack', { method: 'PUT', body: JSON.stringify({ ids: idsOf(pickedActive.value), stack: moveTo.value }) })
		selected.value = new Set()
		moveTo.value = ''
	})
</script>

<template>
	<section>
		<h2>Paintings ({{ visible.length }})</h2>
		<div class="actions bulk">
			<label>
				Stack
				<select v-model="stackFilter">
					<option :value="null">all</option>
					<option v-for="name in stacks" :key="name" :value="name">{{ name || 'none' }}</option>
				</select>
			</label>
			<label>
				#
				<input v-model.trim="numberFilter" type="search" inputmode="numeric" placeholder="all" />
			</label>
			<label>
				Status
				<select v-model="statusFilter">
					<option :value="null">all</option>
					<option v-for="status in paintingStatuses" :key="status" :value="status">{{ status }}</option>
				</select>
			</label>
			<label>
				In stack
				<select v-model="placeFilter">
					<option :value="null">all</option>
					<option>in stack</option>
					<option>removed</option>
				</select>
			</label>
			<label class="check">
				<input v-model="showDeleted" type="checkbox" class="pick" />
				Show deleted
			</label>
		</div>
		<div v-if="picked.length" class="actions bulk">
			<label>
				Status of {{ picked.length }} selected
				<select value="" @change="setSelectedStatus(($event.target as HTMLSelectElement).value as PaintingStatus)">
					<option value="" disabled>set to…</option>
					<option v-for="status in paintingStatuses" :key="status">{{ status }}</option>
				</select>
			</label>
			<button v-if="pickedInStack.length" @click="setSelectedTakenOut(true)">Remove from stack</button>
			<template v-if="pickedRemoved.length">
				<button @click="setSelectedTakenOut(false)">Put back where it was</button>
				<button @click="setSelectedTakenOut(false, true)">Put back on top</button>
			</template>
			<template v-if="pickedActive.length">
				<label>
					Move to stack
					<input v-model.trim="moveTo" list="stack-names" placeholder="name" />
					<datalist id="stack-names">
						<option v-for="name in namedStacks" :key="name" :value="name"></option>
					</datalist>
				</label>
				<button :disabled="!moveTo" @click="moveSelected">Move</button>
				<button @click="setSelectedDeleted(true)">Delete</button>
			</template>
			<button v-if="pickedDeleted.length" @click="setSelectedDeleted(false)">Restore</button>
			<button @click="selected = new Set()">Clear selection</button>
		</div>
		<table>
			<thead>
				<!-- a line of its own, so the checkbox column below can stay narrow; starts right above its arrow -->
				<tr>
					<th colspan="3"></th>
					<th colspan="8" title="Physically taken out of its stack. Unticking puts it back where it was. Separate from the status.">Removed from physical stack</th>
				</tr>
				<tr>
					<th></th>
					<th>Stack</th>
					<th>#</th>
					<th class="narrow" title="Physically taken out of its stack. Unticking puts it back where it was. Separate from the status.">
						<svg viewBox="0 0 10 12" width="15" aria-hidden="true"><path d="M3 0h4v6h3l-5 6-5-6h3z" fill="currentColor" /></svg>
					</th>
					<th>Index</th>
					<th>Name</th>
					<th>Size (cm)</th>
					<th>Rating</th>
					<th>Price{{ changed ? ' (preview)' : '' }}</th>
					<th>Status</th>
					<th>
						<input type="checkbox" class="pick" :checked="allSelected" title="Select all" @change="toggleAll" />
					</th>
				</tr>
			</thead>
			<tbody>
				<tr v-for="painting in visible" :key="painting.id" :class="{ deleted: painting.deleted_at !== null }">
					<td>
						<img v-if="painting.variants_version" :src="imageUrl(painting, 'thumb')" :alt="painting.title" loading="lazy" />
					</td>
					<td>{{ painting.stack }}</td>
					<td>{{ painting.number }}</td>
					<td class="narrow">
						<input
							type="checkbox"
							class="pick"
							title="Physically taken out of its stack. Unticking puts it back where it was. Separate from the status."
							:checked="painting.taken_out_at !== null"
							:disabled="painting.deleted_at !== null"
							@change="setRemoved(painting, ($event.target as HTMLInputElement).checked)"
						/>
					</td>
					<td>{{ painting.stack_index ?? '-' }}</td>
					<td>
						<input
							:value="painting.title"
							placeholder="Untitled"
							@change="rename(painting, ($event.target as HTMLInputElement).value)"
							@keydown.enter="($event.target as HTMLInputElement).blur()"
						/>
					</td>
					<td>{{ sizeLabel(painting) }}</td>
					<td>
						{{ painting.rating?.toFixed(1) ?? '–' }}
						<span class="muted">({{ painting.ratings }})</span>
					</td>
					<td>{{ eur(priceOf(painting)) }}</td>
					<td>
						<select :value="painting.status" @change="setStatus(painting, ($event.target as HTMLSelectElement).value as PaintingStatus)">
							<option v-for="status in paintingStatuses" :key="status">{{ status }}</option>
						</select>
					</td>
					<td>
						<input type="checkbox" class="pick" :checked="selected.has(painting.id)" @change="toggle(painting.id)" />
					</td>
				</tr>
			</tbody>
		</table>
	</section>
</template>
