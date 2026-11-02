<script setup lang="ts">
import { RouterLink, RouterView } from 'vue-router'
import { loadUser, logout, user } from './auth'

loadUser()
const dev = import.meta.env.DEV
</script>

<template>
	<header id="nav">
		<RouterLink to="/">Gallery</RouterLink>
		<RouterLink to="/rate">Rate</RouterLink>
		<RouterLink v-if="user?.role === 'admin'" to="/admin">Admin</RouterLink>
		<RouterLink v-if="dev" to="/capture">Capture</RouterLink>
		<span v-if="user" class="muted">
			{{ user.name }} ·
			<a href="#" @click.prevent="logout">log out</a>
		</span>
	</header>
	<RouterView />
</template>

<style>
#nav {
	display: flex;
	flex-wrap: wrap;
	gap: var(--gap);
	margin-bottom: var(--gap);

	& span {
		margin-left: auto;
	}

	& .router-link-exact-active {
		font-weight: bold;
	}
}
</style>
