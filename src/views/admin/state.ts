// What the tabs of /admin share: the paintings and statuses, kept up to date, and the price formula being edited (the table previews it).
import { computed, ref, watch } from 'vue'
import { authed, user } from '@/auth'
import type { AdminPainting, Status, StripeStatus } from '../../../shared/types'
import { priceFunction, type PriceFn } from '../../../shared/pricing'

export const paintings = ref<AdminPainting[]>([])
// authors (not admins) see the paintings only: no stacks, deleting, statuses, price, payments, keys or log
export const isAdmin = computed(() => user.value?.role === 'admin')
export const statuses = ref<Status[]>([])
export const error = ref('')

// size of the paintings in the lists (rem), remembered on this device
const THUMB_SIZE_KEY = 'admin:thumb-size'
export const thumbSize = ref(4)
try {
	thumbSize.value = Number(localStorage.getItem(THUMB_SIZE_KEY)) || 4
} catch {}
watch(thumbSize, (size) => {
	try {
		localStorage.setItem(THUMB_SIZE_KEY, String(size))
	} catch {}
})

export const namedStacks = computed(() => [...new Set(paintings.value.map((p) => p.stack ?? ''))].filter(Boolean))
// in the stack's order, bottom first (the list comes sorted by position)
export const stackPaintings = (stack: string) => paintings.value.filter((p) => p.stack === stack && p.deleted_at === null)
export const materials = computed(() => [...new Set(paintings.value.map((p) => p.material ?? ''))].filter(Boolean).sort())

export type Pricing = { formula: string; default: string; stripe: StripeStatus | null }
export const pricing = ref<Pricing>({ formula: '', default: '', stripe: null })
export const formula = ref('')
export const preview = computed<{ price: PriceFn | null; error: string }>(() => {
	try {
		return { price: priceFunction(formula.value), error: '' }
	} catch (e) {
		return { price: null, error: (e as Error).message }
	}
})
export const changed = computed(() => formula.value.trim() !== pricing.value.formula)
export const priceOf = (p: AdminPainting) => (changed.value ? preview.value.price?.(p.width_cm, p.height_cm, p.rating) : p.price)
export const eur = (value: number | null | undefined) => (value ? `${value} €` : '–')

export async function load() {
	;[paintings.value, pricing.value, statuses.value] = await Promise.all([
		authed<AdminPainting[]>('/api/admin/paintings'),
		isAdmin.value ? authed<Pricing>('/api/admin/pricing') : pricing.value,
		authed<Status[]>('/api/admin/statuses'),
	])
	if (!changed.value || !formula.value) formula.value = pricing.value.formula
}

export async function act(task: () => Promise<unknown>) {
	error.value = ''
	try {
		await task()
		await load()
	} catch (e) {
		error.value = (e as Error).message
	}
}
