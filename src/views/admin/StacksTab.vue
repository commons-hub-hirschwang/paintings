<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import StackRange from '@/components/StackRange.vue'
import { authed } from '@/auth'
import { act, namedStacks, stackPaintings } from './state'

const renaming = ref<{ stack: string; name: string } | null>(null)
const startRename = () => {
	merging.value = splitting.value = null
	renaming.value = { stack: namedStacks.value[0]!, name: '' }
}
const renameStack = () =>
	act(async () => {
		await authed('/api/admin/stacks/rename', { method: 'PUT', body: JSON.stringify(renaming.value) })
		renaming.value = null
	})

// merge: `upper` is laid on top of `lower`. The preview shows what happens; its button is the confirmation
const merging = ref<{ lower: string; upper: string; name: string } | null>(null)
watch([() => merging.value?.lower, () => merging.value?.upper], ([lower, upper]) => {
	if (merging.value) merging.value.name = `${lower} + ${upper}`
})
const startMerge = () => {
	const [lower = '', upper = ''] = namedStacks.value
	splitting.value = renaming.value = null
	merging.value = { lower, upper, name: `${lower} + ${upper}` }
}
// the stack already chosen on the other side: the two swap places, so they are never the same
function chooseMergeStack(side: 'lower' | 'upper', stack: string) {
	const other = side === 'lower' ? 'upper' : 'lower'
	if (merging.value![other] === stack) merging.value![other] = merging.value![side]
	merging.value![side] = stack
}
const merge = () =>
	act(async () => {
		await authed('/api/admin/stacks/merge', { method: 'POST', body: JSON.stringify(merging.value) })
		merging.value = null
	})

// split: the painting with # `at` and all above become their own stack
const splitting = ref<{ stack: string; at: number | ''; lower: string; upper: string } | null>(null)
const splittable = computed(() => namedStacks.value.filter((name) => stackPaintings(name).length > 1))
const splitOf = (stack: string) => ({ stack, at: stackPaintings(stack)[1]?.number ?? ('' as const), lower: `${stack} A`, upper: `${stack} B` })
const startSplit = () => {
	merging.value = renaming.value = null
	splitting.value = splitOf(splittable.value[0]!)
}
const chooseSplitStack = (stack: string) => (splitting.value = splitOf(stack))
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
</script>

<template>
	<section v-if="namedStacks.length">
		<h2>Stacks</h2>
		<div class="actions">
			<button :disabled="namedStacks.length < 2" @click="startMerge">Merge two stacks</button>
			<button :disabled="!splittable.length" @click="startSplit">Split stacks</button>
			<button @click="startRename">Rename stack</button>
		</div>

		<div v-if="renaming" class="dialog">
			<label>
				Stack
				<select v-model="renaming.stack">
					<option v-for="name in namedStacks" :key="name">{{ name }}</option>
				</select>
			</label>
			<label>
				New name
				<input v-model.trim="renaming.name" @keydown.enter="renaming.name && renameStack()" />
			</label>
			<div class="actions">
				<button :disabled="!renaming.name" @click="renameStack">Rename</button>
				<button @click="renaming = null">Cancel</button>
			</div>
		</div>

		<div v-if="merging" class="dialog">
			<label>
				Below
				<select :value="merging.lower" @change="chooseMergeStack('lower', ($event.target as HTMLSelectElement).value)">
					<option v-for="name in namedStacks" :key="name">{{ name }}</option>
				</select>
			</label>
			<label>
				On top
				<select :value="merging.upper" @change="chooseMergeStack('upper', ($event.target as HTMLSelectElement).value)">
					<option v-for="name in namedStacks" :key="name">{{ name }}</option>
				</select>
			</label>
			<label>
				Merged stack name
				<input v-model.trim="merging.name" />
			</label>
			<p class="muted">The paintings on top get new numbers, continuing above the ones below.</p>
			<StackRange :name="`${merging.lower} (below)`" :paintings="stackPaintings(merging.lower)" />
			<StackRange :name="`${merging.upper} (on top)`" :paintings="stackPaintings(merging.upper)" />
			<div class="actions">
				<button :disabled="!merging.name" @click="merge">Merge into "{{ merging.name }}"</button>
				<button @click="merging = null">Cancel</button>
			</div>
		</div>

		<div v-if="splitting" class="dialog">
			<div class="sentence">
				Split
				<select :value="splitting.stack" aria-label="Stack to split" @change="chooseSplitStack(($event.target as HTMLSelectElement).value)">
					<option v-for="name in splittable" :key="name">{{ name }}</option>
				</select>
				at #
				<input v-model.number="splitting.at" class="number" type="number" min="0" aria-label="Number to split at" />
				into
				<input v-model.trim="splitting.lower" aria-label="Lower stack name" />
				and
				<input v-model.trim="splitting.upper" aria-label="Upper stack name" />
			</div>
			<StackRange :name="splitting.lower" :paintings="splitParts.lower" />
			<StackRange :name="splitting.upper" :paintings="splitParts.upper" />
			<div class="actions">
				<button :disabled="!splitParts.lower.length || !splitParts.upper.length || !splitting.lower || !splitting.upper" @click="split">
					Split into "{{ splitting.lower }}" and "{{ splitting.upper }}"
				</button>
				<button @click="splitting = null">Cancel</button>
			</div>
		</div>
	</section>
</template>
