<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import LoginGate from '@/components/LoginGate.vue'
import StackRange from '@/components/StackRange.vue'
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

const renameStack = (stack: string, name: string) =>
	act(() => authed('/api/admin/stacks/rename', { method: 'PUT', body: JSON.stringify({ stack, name }) }))

// filters (null = all); deleted paintings only show up when filtering for them
const stackFilter = ref<string | null>(null)
const numberFilter = ref('')
const statusFilter = ref<PaintingStatus | 'deleted' | 'taken out' | null>(null)
// the stacks in the list ('' = paintings without one); the admin list is sorted by stack and #
const stacks = computed(() => [...new Set(paintings.value.map((p) => p.stack ?? ''))])
const namedStacks = computed(() => stacks.value.filter(Boolean))
const stackPaintings = (stack: string) => paintings.value.filter((p) => p.stack === stack && p.deleted_at === null)
const visible = computed(() =>
	paintings.value.filter(
		(p) =>
			(stackFilter.value === null || (p.stack ?? '') === stackFilter.value) &&
			(numberFilter.value === '' || String(p.number) === numberFilter.value) &&
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

const setSelectedTakenOut = (out: boolean, onTop = false) =>
	act(async () => {
		await authed('/api/admin/paintings/taken-out', { method: 'PUT', body: JSON.stringify({ ids: picked.value, out, onTop }) })
		selected.value = new Set()
	})

const moveTo = ref('')
const moveSelected = () =>
	act(async () => {
		await authed('/api/admin/paintings/stack', { method: 'PUT', body: JSON.stringify({ ids: picked.value, stack: moveTo.value }) })
		selected.value = new Set()
		moveTo.value = ''
	})

// merge: `upper` is laid on top of `lower`. The preview shows what happens; its button is the confirmation
const merging = ref<{ lower: string; upper: string; name: string } | null>(null)
watch([() => merging.value?.lower, () => merging.value?.upper], ([lower, upper]) => {
	if (merging.value) merging.value.name = `${lower} + ${upper}`
})
const startMerge = () => {
	const [lower = '', upper = ''] = namedStacks.value
	splitting.value = null
	merging.value = { lower, upper, name: `${lower} + ${upper}` }
}
const merge = () =>
	act(async () => {
		await authed('/api/admin/stacks/merge', { method: 'POST', body: JSON.stringify(merging.value) })
		merging.value = null
	})

// split: the painting with # `at` and all above become their own stack
const splitting = ref<{ stack: string; at: number | ''; lower: string; upper: string } | null>(null)
const startSplit = (stack: string) => {
	merging.value = null
	splitting.value = { stack, at: stackPaintings(stack)[1]?.number ?? '', lower: `${stack} A`, upper: `${stack} B` }
}
const splitParts = computed(() => {
	const { stack, at } = splitting.value ?? { stack: '', at: '' }
	const all = stackPaintings(stack)
	return at === '' ? { lower: all, upper: [] } : { lower: all.filter((p) => p.number! < at), upper: all.filter((p) => p.number! >= at) }
})
const split = () =>
	act(async () => {
		await authed('/api/admin/stacks/split', { method: 'POST', body: JSON.stringify(splitting.value) })
		splitting.value = null
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

			<section v-if="namedStacks.length">
				<h2>Stacks</h2>
				<p class="muted">The name is the stack: renaming here is what the capture tool sees next. Split and merge need a look at the preview first.</p>
				<div class="actions">
					<span v-for="name in namedStacks" :key="name" class="stack">
						<input
							:value="name"
							aria-label="Stack name"
							@change="renameStack(name, ($event.target as HTMLInputElement).value)"
							@keydown.enter="($event.target as HTMLInputElement).blur()"
						/>
						<button :disabled="stackPaintings(name).length < 2" @click="startSplit(name)">Split</button>
					</span>
					<button :disabled="namedStacks.length < 2" @click="startMerge">Merge two stacks</button>
				</div>

				<div v-if="merging" class="dialog">
					<label>
						Below
						<select v-model="merging.lower">
							<option v-for="name in namedStacks" :key="name">{{ name }}</option>
						</select>
					</label>
					<label>
						On top
						<select v-model="merging.upper">
							<option v-for="name in namedStacks" :key="name">{{ name }}</option>
						</select>
					</label>
					<label>
						Merged stack name
						<input v-model.trim="merging.name" />
					</label>
					<p class="muted">The paintings on top get new numbers, continuing above the ones below.</p>
					<StackRange :name="`${merging.upper} (on top)`" :paintings="stackPaintings(merging.upper)" />
					<StackRange :name="`${merging.lower} (below)`" :paintings="stackPaintings(merging.lower)" />
					<div class="actions">
						<button :disabled="merging.lower === merging.upper || !merging.name" @click="merge">Merge into "{{ merging.name }}"</button>
						<button @click="merging = null">Cancel</button>
					</div>
				</div>

				<div v-if="splitting" class="dialog">
					<label>
						Split {{ splitting.stack }} at #
						<input v-model.number="splitting.at" type="number" min="0" />
					</label>
					<label>
						Lower stack name
						<input v-model.trim="splitting.lower" />
					</label>
					<label>
						Upper stack name
						<input v-model.trim="splitting.upper" />
					</label>
					<p class="muted">The upper part gets new numbers from #0. Taken-out paintings go with their part.</p>
					<StackRange :name="splitting.upper" :paintings="splitParts.upper" />
					<StackRange :name="splitting.lower" :paintings="splitParts.lower" />
					<div class="actions">
						<button :disabled="!splitParts.lower.length || !splitParts.upper.length || !splitting.lower || !splitting.upper" @click="split">
							Split into "{{ splitting.lower }}" and "{{ splitting.upper }}"
						</button>
						<button @click="splitting = null">Cancel</button>
					</div>
				</div>
			</section>

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
					<template v-if="statusFilter === 'taken out'">
						<button @click="setSelectedTakenOut(false)">Put back where it was</button>
						<button @click="setSelectedTakenOut(false, true)">Put back on top</button>
					</template>
					<button v-else-if="statusFilter !== 'deleted'" @click="setSelectedTakenOut(true)">Take out of stack</button>
					<template v-if="statusFilter !== 'deleted'">
						<label>
							Move to stack
							<input v-model.trim="moveTo" list="stack-names" placeholder="name" />
							<datalist id="stack-names">
								<option v-for="name in namedStacks" :key="name" :value="name"></option>
							</datalist>
						</label>
						<button :disabled="!moveTo" @click="moveSelected">Move</button>
					</template>
					<button v-if="statusFilter === 'deleted'" @click="setSelectedDeleted(false)">Restore</button>
					<button v-else @click="setSelectedDeleted(true)">Delete</button>
					<button @click="selected = new Set()">Clear selection</button>
				</div>
				<table>
					<tr>
						<th></th>
						<th>Stack</th>
						<th>#</th>
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
						<td>{{ painting.stack }}</td>
						<td>{{ painting.number }}</td>
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

	& .stack {
		display: flex;
		gap: 0.3rem;
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
