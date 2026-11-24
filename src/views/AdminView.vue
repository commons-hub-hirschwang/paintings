<script setup lang="ts">
import { computed, onBeforeUnmount, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import LoginGate from '@/components/LoginGate.vue'
import { user } from '@/auth'
import { canName } from '../../shared/types'
import KeysTab from './admin/KeysTab.vue'
import LogsTab from './admin/LogsTab.vue'
import OrdersTab from './admin/OrdersTab.vue'
import PaintingsTab from './admin/PaintingsTab.vue'
import PriceTab from './admin/PriceTab.vue'
import StacksTab from './admin/StacksTab.vue'
import StatusesTab from './admin/StatusesTab.vue'
import UsersTab from './admin/UsersTab.vue'
import { error, isAdmin, load, thumbSize } from './admin/state'

const allTabs = {
	stacks: { label: 'Stacks', component: StacksTab },
	paintings: { label: 'Paintings', component: PaintingsTab },
	statuses: { label: 'Statuses', component: StatusesTab },
	price: { label: 'Price & payments', component: PriceTab },
	orders: { label: 'Orders', component: OrdersTab },
	users: { label: 'Users', component: UsersTab },
	keys: { label: 'Keys', component: KeysTab },
	logs: { label: 'Logs', component: LogsTab },
}
type Tab = keyof typeof allTabs

// in the URL, so a reload stays on the tab
const route = useRoute()
const router = useRouter()
// authors: the paintings only (naming, size, material, status, turn)
const tab = computed<Tab>(() => (isAdmin.value && (route.query.tab as string) in allTabs ? (route.query.tab as Tab) : 'paintings'))
const openTab = (name: string) => router.replace({ query: { tab: name } })

watch(user, (u) => canName(u?.role) && load().catch((e) => (error.value = e.message)), { immediate: true })

// live view: paintings arriving from a capture sync (or changed elsewhere) show up without reloading;
// paused while typing in a name, as the update would overwrite the input
const LIVE_INTERVAL = 10_000
const live = setInterval(() => {
	if (canName(user.value?.role) && document.visibilityState === 'visible' && !document.querySelector('#admin input:not(.pick):focus'))
		load().catch(() => {})
}, LIVE_INTERVAL)
onBeforeUnmount(() => clearInterval(live))
</script>

<template>
	<main id="admin" :style="{ '--thumb': `${thumbSize}rem` }">
		<h1>Admin</h1>
		<LoginGate :roles="['admin', 'author']">
			<nav v-if="isAdmin" class="tabs">
				<button v-for="(t, name) in allTabs" :key="name" :aria-current="tab === name ? 'page' : undefined" @click="openTab(name)">{{ t.label }}</button>
			</nav>
			<p v-if="error" class="error">{{ error }}</p>
			<!-- kept alive: filters, a selection or a half-filled form survive switching tabs -->
			<KeepAlive>
				<component :is="allTabs[tab].component" />
			</KeepAlive>
		</LoginGate>
	</main>
</template>

<style>
#admin {
	display: flex;
	flex-direction: column;
	gap: var(--gap);

	& nav.tabs {
		display: flex;
		flex-wrap: wrap;
		gap: 0.5rem;

		& button[aria-current='page'] {
			font-weight: bold;
			border-bottom-width: 3px;
		}
	}

	& section {
		display: flex;
		flex-direction: column;
		gap: var(--gap);
	}

	& table {
		border-collapse: collapse;

		/* the header stays visible while the page scrolls the rows under it */
		& thead {
			position: sticky;
			top: 0;
			z-index: 1;
			background: var(--bg);
			/* collapsed borders don't stick along, this line does */
			box-shadow: 0 1px 0 color-mix(in srgb, var(--muted) 30%, transparent);

			/* a semi-transparent border inside would let the rows show through */
			& th {
				border-bottom: none;
			}
		}

		& th {
			text-align: left;
		}

		/* just as wide as its content, centered */
		& .narrow {
			width: 1%;
			text-align: center;
		}

		& td,
		& th {
			padding: 0.3rem 0.6rem;
			border-bottom: 1px solid color-mix(in srgb, var(--muted) 30%, transparent);
		}

		& img {
			display: block;
			width: var(--thumb);
			height: var(--thumb);
			object-fit: contain;
		}

		/* selection: large, easy to hit in a row */
		& .pick {
			width: 1.6rem;
			height: 1.6rem;
			cursor: pointer;
		}

		/* ↺ above ↻ */
		& .turn button {
			display: block;
		}
	}

	& .bulk {
		align-items: flex-end;
		font-weight: normal;
	}

	& .check {
		flex-direction: row;
		align-items: center;
		gap: 0.5rem;
	}

	& tr.deleted {
		opacity: 0.5;
	}

	& .dialog > .actions {
		flex-basis: 100%;
	}

	/* a form that reads as one line */
	& .sentence {
		flex-basis: 100%;
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 0.5rem;

		& .number {
			width: 5rem;
		}
	}

	& .payments input {
		flex: 1;
		min-width: 16rem;
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
