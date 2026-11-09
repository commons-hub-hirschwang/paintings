<script setup lang="ts">
import { computed } from 'vue'
import { RouterLink, RouterView, useRoute } from 'vue-router'
import { loadUser, logout, user } from './auth'

loadUser()
const route = useRoute()

// the other pages this user can open (every role rates); the gallery from /admin and /rate (paintings have their own link)
const pages = computed(() => {
	if (!user.value) return []
	const all = [
		{ to: '/', label: 'gallery', show: route.name === 'admin' || route.name === 'rate' },
		{ to: '/admin', label: 'admin', show: user.value.role === 'admin' && route.name !== 'admin' },
		{ to: '/rate', label: 'rate', show: route.name !== 'rate' },
	]
	return all.filter((page) => page.show)
})
</script>

<template>
	<!-- no navigation: /rate, /admin and /capture are reached by URL only -->
	<header v-if="user !== undefined" id="nav">
		<span v-if="user" class="muted">
			{{ user.name }} ·
			<a href="#" @click.prevent="logout">log out</a>
		</span>
		<span v-else class="muted">gast</span>
	</header>
	<nav v-if="pages.length" id="pages" class="muted">
		<RouterLink v-for="page in pages" :key="page.to" :to="page.to">{{ page.label }}</RouterLink>
	</nav>
	<RouterView />
</template>

<style>
#nav {
	display: flex;
	flex-wrap: wrap;
	gap: var(--gap);
	margin-bottom: var(--gap);

	/* top-right in #app, aligned with the content's right edge; takes no layout space (rating stage uses the full
	   viewport) */
	position: absolute;
	right: calc(var(--gap) - 0.6rem); /* text, not the padded box, on the edge */
	top: var(--gap);
	z-index: 1;
	padding: 0.2rem 0.6rem;
	border-radius: 0.3rem;
	background: var(--bg);
}

/* links to the other pages, top center (like #nav: no layout space) */
#pages {
	position: absolute;
	top: var(--gap);
	left: 50%;
	translate: -50% 0;
	z-index: 1;
	display: flex;
	gap: var(--gap);
	padding: 0.2rem 0.6rem;
	border-radius: 0.3rem;
	background: var(--bg);
}
</style>
