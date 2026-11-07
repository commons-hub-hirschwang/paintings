<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import LoginGate from '@/components/LoginGate.vue'
import { authed, user } from '@/auth'
import { imageUrl } from '@/api'
import { paintingStatuses, sizeLabel, type AdminPainting, type PaintingStatus, type UploadKey } from '../../shared/types'
import { priceExamples, priceFunction, priceVariables, type PriceFn } from '../../shared/pricing'
import { functions } from '../../shared/expr'

const paintings = ref<AdminPainting[]>([])
const keys = ref<UploadKey[]>([])
const keyName = ref('')
const newKey = ref<{ name: string; key: string } | null>(null)
const error = ref('')

// price formula: edited here, previewed live (examples + table), saved to the server
const pricing = ref({ formula: '', default: '' })
const formula = ref('')
const preview = computed<{ price: PriceFn | null; error: string }>(() => {
	try {
		return { price: priceFunction(formula.value), error: '' }
	} catch (e) {
		return { price: null, error: (e as Error).message }
	}
})
const changed = computed(() => formula.value.trim() !== pricing.value.formula)
const priceOf = (p: AdminPainting) => (changed.value ? preview.value.price?.(p.width_cm, p.height_cm, p.rating) : p.price)
const eur = (value: number | null | undefined) => (value ? `${value} €` : '–')

async function load() {
	;[paintings.value, keys.value, pricing.value] = await Promise.all([
		authed<AdminPainting[]>('/api/admin/paintings'),
		authed<UploadKey[]>('/api/admin/keys'),
		authed<{ formula: string; default: string }>('/api/admin/pricing'),
	])
	if (!changed.value || !formula.value) formula.value = pricing.value.formula
}

const savePricing = () => act(() => authed('/api/admin/pricing', { method: 'PUT', body: JSON.stringify({ formula: formula.value }) }))
watch(user, (u) => u?.role === 'admin' && load().catch((e) => (error.value = e.message)), { immediate: true })

// live view: paintings arriving from a capture sync (or changed elsewhere) show up without reloading;
// paused while typing in a name, as the update would overwrite the input
const LIVE_INTERVAL = 10_000
const live = setInterval(() => {
	if (user.value?.role === 'admin' && document.visibilityState === 'visible' && !document.querySelector('#admin input:not(.pick):focus'))
		load().catch(() => {})
}, LIVE_INTERVAL)
onBeforeUnmount(() => clearInterval(live))

async function act(task: () => Promise<unknown>) {
	error.value = ''
	try {
		await task()
		await load()
	} catch (e) {
		error.value = (e as Error).message
	}
}

const rename = (painting: AdminPainting, title: string) =>
	act(() => authed(`/api/rate/paintings/${painting.id}/title`, { method: 'PUT', body: JSON.stringify({ title }) }))

const setStatus = (painting: AdminPainting, status: PaintingStatus) =>
	act(() => authed(`/api/admin/paintings/${painting.id}`, { method: 'PATCH', body: JSON.stringify({ status }) }))

const renameStack = (id: string, name: string) =>
	act(() => authed(`/api/admin/stacks/${id}`, { method: 'PUT', body: JSON.stringify({ name }) }))

// filters (null = all); deleted paintings only show up when filtering for them
const stackFilter = ref<string | null>(null)
const indexFilter = ref('')
const statusFilter = ref<PaintingStatus | 'deleted' | 'taken out' | null>(null)
// [id, name]; id '' = paintings without a stack
const stacks = computed(() => [...new Map(paintings.value.map((p) => [p.stack_id ?? '', p.stack_name ?? '']))])
const visible = computed(() =>
	paintings.value.filter(
		(p) =>
			(stackFilter.value === null || (p.stack_id ?? '') === stackFilter.value) &&
			(indexFilter.value === '' || String(p.stack_index) === indexFilter.value) &&
			(statusFilter.value === 'deleted'
				? p.deleted_at !== null
				: p.deleted_at === null &&
					(statusFilter.value === 'taken out' ? p.taken_out_at !== null : statusFilter.value === null || p.status === statusFilter.value)),
	),
)

// selection (checkboxes on the right) → status of all selected at once; only ever acts on what the filters show
const selected = ref(new Set<string>())
const picked = computed(() => visible.value.filter((p) => selected.value.has(p.id)).map((p) => p.id))
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
		await authed('/api/admin/paintings/deleted', { method: 'PUT', body: JSON.stringify({ ids: picked.value, deleted }) })
		selected.value = new Set()
	})

const setSelectedTakenOut = (out: boolean) =>
	act(async () => {
		await authed('/api/admin/paintings/taken-out', { method: 'PUT', body: JSON.stringify({ ids: picked.value, out }) })
		selected.value = new Set()
	})

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

			<section v-if="stacks.some(([id]) => id)">
				<h2>Stacks</h2>
				<p class="muted">Rename a stack here; the new name is used everywhere, including the capture tool.</p>
				<div class="actions">
					<template v-for="[id, name] in stacks" :key="id">
						<input
							v-if="id"
							:value="name"
							aria-label="Stack name"
							@change="renameStack(id, ($event.target as HTMLInputElement).value)"
							@keydown.enter="($event.target as HTMLInputElement).blur()"
						/>
					</template>
				</div>
			</section>

			<section>
				<h2>Paintings ({{ visible.length }})</h2>
				<div class="actions bulk">
					<label>
						Stack
						<select v-model="stackFilter">
							<option :value="null">all</option>
							<option v-for="[id, name] in stacks" :key="id" :value="id">{{ name || 'none' }}</option>
						</select>
					</label>
					<label>
						Index
						<input v-model.trim="indexFilter" type="search" inputmode="numeric" placeholder="all" />
					</label>
					<label>
						Status
						<select v-model="statusFilter">
							<option :value="null">all</option>
							<option v-for="status in paintingStatuses" :key="status" :value="status">{{ status }}</option>
							<option value="taken out">taken out</option>
							<option value="deleted">deleted</option>
						</select>
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
					<button v-if="statusFilter === 'taken out'" @click="setSelectedTakenOut(false)">Put back into stack</button>
					<button v-else-if="statusFilter !== 'deleted'" @click="setSelectedTakenOut(true)">Take out of stack</button>
					<button v-if="statusFilter === 'deleted'" @click="setSelectedDeleted(false)">Restore</button>
					<button v-else @click="setSelectedDeleted(true)">Delete</button>
					<button @click="selected = new Set()">Clear selection</button>
				</div>
				<table>
					<tr>
						<th></th>
						<th>Stack</th>
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
					<tr v-for="painting in visible" :key="painting.id">
						<td>
							<img v-if="painting.variants_version" :src="imageUrl(painting, 'thumb')" :alt="painting.title" loading="lazy" />
						</td>
						<td>{{ painting.stack_name }}</td>
						<td>{{ painting.taken_out_at ? 'taken out' : painting.stack_index }}</td>
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
				</table>
			</section>

			<fieldset class="pricing">
				<legend>Price formula</legend>
				<p class="muted">
					Variables: {{ priceVariables.join(', ') }} (rating = average 1–10). Functions: {{ Object.keys(functions).join(', ') }};
					round(x, 10) rounds to 10 €. Operators + − × / % ^. Result is rounded to whole euros; unrated paintings have no price.
				</p>
				<textarea v-model="formula" rows="2" spellcheck="false"></textarea>
				<p v-if="preview.error" class="error">{{ preview.error }}</p>
				<p v-else>
					<span v-for="e in priceExamples" :key="`${e.widthCm}${e.heightCm}${e.rating}`" class="example">
						{{ e.widthCm }}×{{ e.heightCm }} cm, rated {{ e.rating }}: <strong>{{ eur(preview.price?.(e.widthCm, e.heightCm, e.rating)) }}</strong>
					</span>
				</p>
				<div class="actions">
					<button :disabled="!changed || !!preview.error" @click="savePricing">Save formula</button>
					<button :disabled="formula === pricing.default" @click="formula = pricing.default">Default</button>
					<button :disabled="!changed" @click="formula = pricing.formula">Undo</button>
				</div>
			</fieldset>

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

		/* selection: large, easy to hit in a row */
		& .pick {
			width: 1.6rem;
			height: 1.6rem;
			cursor: pointer;
		}
	}

	& .bulk {
		align-items: flex-end;
	}

	& .pricing {
		& textarea {
			font-family: monospace;
			resize: vertical;
		}

		& .example {
			margin-right: var(--gap);
			white-space: nowrap;
		}
	}

	& code {
		user-select: all;
		word-break: break-all;
	}
}
</style>
