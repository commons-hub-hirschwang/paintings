<script setup lang="ts">
// Reorder a stack without dragging: click the paintings to move, they get 1, 2, 3… (again: the number goes, the later ones
// move down); click a diamond between two paintings to put them there in that order. Picking all of them asks right away.
// "Invert order" turns the whole stack upside down. Taken-out paintings aren't shown: they keep their place (server: PUT /stacks/order).
import { computed, nextTick, ref, watch } from 'vue'
import { authed } from '@/auth'
import { imageUrl } from '@/api'
import { sizeLabel } from '../../../shared/types'
import { act, namedStacks, stackPaintings, thumbSize } from './state'

defineEmits<{ close: [] }>()

const stack = ref(namedStacks.value[0] ?? '')
const rows = computed(() => stackPaintings(stack.value).filter((p) => p.taken_out_at === null))

const picks = ref<string[]>([])
watch(stack, () => (picks.value = []))
// live updates: a painting gone from the stack is no longer picked
watch(rows, (list) => {
	const ids = new Set(list.map((p) => p.id))
	if (picks.value.some((id) => !ids.has(id))) picks.value = picks.value.filter((id) => ids.has(id))
})
const togglePick = (id: string) => (picks.value = picks.value.includes(id) ? picks.value.filter((p) => p !== id) : [...picks.value, id])
const allPicked = computed(() => rows.value.length > 1 && picks.value.length === rows.value.length)

// the gap the picked paintings go to: before row `gap` (rows.length: on top); 'invert': the whole stack upside down;
// null: not asking
const gap = ref<number | 'invert' | null>(null)
const dialog = ref<HTMLDialogElement>()
async function ask(at: number | 'invert') {
	gap.value = at
	await nextTick()
	dialog.value?.showModal()
}
watch(allPicked, (all) => all && ask(0))

function newOrder(at: number) {
	const picked = new Set(picks.value)
	const rest = rows.value.filter((p) => !picked.has(p.id)).map((p) => p.id)
	const k = rows.value.slice(0, at).filter((p) => !picked.has(p.id)).length
	return [...rest.slice(0, k), ...picks.value, ...rest.slice(k)]
}
function confirm() {
	const ids = gap.value === 'invert' ? rows.value.map((p) => p.id).reverse() : newOrder(gap.value!)
	dialog.value?.close()
	return act(async () => {
		await authed('/api/admin/stacks/order', { method: 'PUT', body: JSON.stringify({ stack: stack.value, ids }) })
		picks.value = []
	})
}
</script>

<template>
	<div class="dialog reorder">
		<div class="sentence">
			Reorder
			<select v-model="stack" aria-label="Stack to reorder">
				<option v-for="name in namedStacks" :key="name">{{ name }}</option>
			</select>
			<span class="muted">bottom first · {{ rows.length }} paintings in the stack</span>
			<button :disabled="rows.length < 2" @click="ask('invert')">Invert order</button>
			<label class="check">Image size <input v-model.number="thumbSize" type="range" min="2" max="24" step="1" /></label>
		</div>
		<p class="muted">Click the paintings to move in the order they should end up in, then the ◆ where they go.</p>
		<table>
			<thead>
				<tr>
					<th class="narrow"></th>
					<th class="narrow">Move</th>
					<th></th>
					<th>#</th>
					<th>Name</th>
					<th>Size</th>
				</tr>
			</thead>
			<tbody>
				<tr v-for="(painting, i) in rows" :key="painting.id" :class="{ picked: picks.includes(painting.id) }">
					<td class="narrow gap">
						<button class="diamond" :disabled="!picks.length" title="Move the picked paintings here" @click="ask(i)"></button>
						<button
							v-if="i === rows.length - 1"
							class="diamond last"
							:disabled="!picks.length"
							title="Move the picked paintings here"
							@click="ask(rows.length)"
						></button>
					</td>
					<td class="narrow">
						<button class="order" @click="togglePick(painting.id)">{{ picks.indexOf(painting.id) + 1 || '' }}</button>
					</td>
					<td>
						<img v-if="painting.variants_version" :src="imageUrl(painting, 'thumb')" :alt="painting.title" loading="lazy" />
					</td>
					<td>{{ painting.number }}</td>
					<td>{{ painting.title || 'Untitled' }}</td>
					<td>{{ sizeLabel(painting) }}</td>
				</tr>
			</tbody>
		</table>
		<div class="actions">
			<button :disabled="!picks.length" @click="picks = []">Clear numbers</button>
			<button @click="$emit('close')">Close</button>
		</div>

		<dialog ref="dialog" @close="gap = null">
			<p v-if="gap === 'invert'">Turn all {{ rows.length }} paintings of "{{ stack }}" upside down (the top one goes to the bottom)?</p>
			<p v-else-if="allPicked">Put all {{ picks.length }} paintings of "{{ stack }}" in the selected order?</p>
			<p v-else>Move the {{ picks.length }} picked paintings here, in the selected order?</p>
			<div class="actions">
				<button @click="confirm">Reorder</button>
				<button @click="dialog?.close()">Cancel</button>
			</div>
		</dialog>
	</div>
</template>

<style>
#admin .reorder {
	& table {
		flex-basis: 100%;

		/* not sticky here: it would cover the topmost diamond */
		& thead {
			position: static;
		}
	}

	& .gap {
		position: relative;
		min-width: calc(var(--order-size) + 1.2rem);
	}

	--order-size: 2.6rem;

	/* a diamond on the line above its row; the last row also has one on the line below. As tall as a number field
	   (a square turned by 45° is √2 times its side) */
	& .diamond {
		position: absolute;
		left: 50%;
		top: 0;
		z-index: 1;
		width: calc(var(--order-size) / 1.4142);
		height: calc(var(--order-size) / 1.4142);
		padding: 0;
		transform: translate(-50%, -50%) rotate(45deg);
		background: var(--bg);

		&.last {
			top: 100%;
		}

		&:hover:not(:disabled) {
			background: var(--fg);
		}
	}

	& .order {
		width: var(--order-size);
		height: var(--order-size);
		padding: 0;
		font-weight: bold;
	}

	& tr.picked {
		background: color-mix(in srgb, var(--fg) 12%, transparent);
	}

	& dialog {
		background: var(--bg);
		color: var(--fg);
		border: 1px solid var(--muted);
		border-radius: 0.3rem;
	}
}
</style>
