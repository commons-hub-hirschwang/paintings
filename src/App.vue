<script setup lang="ts">
import { RouterView } from 'vue-router'
import { loadUser, logout, user } from './auth'

loadUser()
</script>

<template>
	<!-- no navigation: /rate, /admin and /capture are reached by URL only -->
	<header v-if="user" id="nav">
		<span class="muted">
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

	justify-content: flex-end;
}
</style>
