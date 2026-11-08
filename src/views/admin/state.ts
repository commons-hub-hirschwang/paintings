// What the tabs of /admin share: the paintings, kept up to date, and the price formula being edited (the table previews it).
import { computed, ref } from 'vue'
import { authed } from '@/auth'
import type { AdminPainting } from '../../../shared/types'
import { priceFunction, type PriceFn } from '../../../shared/pricing'

export const paintings = ref<AdminPainting[]>([])
export const error = ref('')

export const namedStacks = computed(() => [...new Set(paintings.value.map((p) => p.stack ?? ''))].filter(Boolean))
export const stackPaintings = (stack: string) => paintings.value.filter((p) => p.stack === stack && p.deleted_at === null)

export type Pricing = { formula: string; default: string; stripe: boolean; webhook: boolean }
export const pricing = ref<Pricing>({ formula: '', default: '', stripe: false, webhook: false })
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
	;[paintings.value, pricing.value] = await Promise.all([authed<AdminPainting[]>('/api/admin/paintings'), authed<Pricing>('/api/admin/pricing')])
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
