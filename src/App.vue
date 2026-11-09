<script setup lang="ts">
import { computed } from 'vue'
import { RouterLink, RouterView, useRoute, useRouter } from 'vue-router'
import { loadUser, logout, user } from './auth'

loadUser()
const route = useRoute()
const router = useRouter()

// back to where the gallery was (its scroll position) when coming from it, else open it
function backToGallery() {
	if (history.state?.back === '/') router.back()
	else router.push('/')
}

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
	<!-- one row: the page's own item, links to the other pages, login -->
	<header id="top">
		<div id="header-start">
			<template v-if="route.name === 'gallery'">
				<strong>Thomas Fritsch</strong><br />
				Digitale Galerie an der Rax
			</template>
			<a v-else-if="route.name === 'painting'" href="/" @click.prevent="backToGallery">← Gallery</a>
		</div>
		<nav v-if="pages.length" id="pages" class="muted">
			<RouterLink v-for="page in pages" :key="page.to" :to="page.to">{{ page.label }}</RouterLink>
		</nav>
		<div id="login-info" class="muted">
			<template v-if="user">
				<span class="name">{{ user.name }}</span>
				<a href="#" @click.prevent="logout">log out</a>
			</template>
			<!-- login form on /rate: every role can open it -->
			<template v-else-if="user === null">
				<span class="name">gast</span>
				<RouterLink to="/rate">log in</RouterLink>
			</template>
		</div>
	</header>
	<RouterView />
</template>

<style>
/* Narrow: all three shrink in proportion to their length, so each wraps about as much as the others (the start takes
   what is left). Wide: the links exactly in the middle. */
#top {
	display: flex;
	align-items: center;
	column-gap: 1.5rem;
	margin-bottom: var(--gap);

	& > * {
		flex: 0 1 auto;
	}

	& #header-start {
		flex-grow: 1;
	}

	@media (min-width: 60rem) {
		display: grid;
		grid-template-columns: 1fr auto 1fr;

		& #header-start {
			grid-column: 1;
		}

		& #login-info {
			grid-column: 3;
		}
	}

	/* name and "log out" may break onto two lines; the dot between them only shows on one line: it sits in the gap
	   after the name and is cut off at the edge when the name ends a line */
	& #login-info {
		display: flex;
		flex-wrap: wrap;
		justify-content: flex-end;
		column-gap: 1rem;
		overflow: hidden;
		/* overflow alone would let it shrink to nothing */
		min-width: min-content;

		& .name {
			position: relative;

			&::after {
				content: '·';
				position: absolute;
				left: 100%;
				width: 1rem;
				text-align: center;
			}
		}
	}

	& #pages {
		display: flex;
		flex-wrap: wrap;
		justify-content: center;
		column-gap: 1rem;
	}
}
</style>
