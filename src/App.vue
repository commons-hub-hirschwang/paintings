<script setup lang="ts">
import { RouterView } from 'vue-router'
import { loadUser, logout, user } from './auth'

loadUser()
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
</style>
