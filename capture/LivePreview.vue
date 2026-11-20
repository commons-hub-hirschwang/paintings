<script setup lang="ts">
// The camera's live view (bridge: GET /preview), frame after frame while shown: is the painting in the frame?
// Nothing is taken or saved. Unmounted, it stops; a capture waits for the frame being fetched.
import { onBeforeUnmount, onMounted, ref } from 'vue'

const src = ref('')
const error = ref('')
let running = true

async function loop() {
	while (running) {
		try {
			const response = await fetch('/bridge/preview', { cache: 'no-store' })
			if (response.status === 200) {
				const url = URL.createObjectURL(await response.blob())
				if (src.value) URL.revokeObjectURL(src.value)
				if (running) src.value = url
				else URL.revokeObjectURL(url)
				error.value = ''
			} else if (response.status !== 204) error.value = ((await response.json().catch(() => null)) as { error?: string } | null)?.error ?? 'no live view'
		} catch {
			error.value = 'bridge not reachable'
		}
		// busy or failing: don't hammer the camera
		if (error.value || !src.value) await new Promise((resolve) => setTimeout(resolve, 1000))
	}
}
onMounted(loop)
onBeforeUnmount(() => {
	running = false
	if (src.value) URL.revokeObjectURL(src.value)
})
</script>

<template>
	<figure class="live-preview">
		<img v-if="src" :src="src" alt="Live view of the camera" />
		<figcaption class="muted">{{ error ? `Live view: ${error}` : src ? 'Live view' : 'Live view starting…' }}</figcaption>
	</figure>
</template>

<style>
.live-preview {
	flex: 1 1 0;
	min-height: 0;
	margin: 0;
	display: flex;
	flex-direction: column;
	align-items: center;
	gap: 0.3rem;

	& img {
		flex: 1 1 0;
		min-height: 0;
		max-width: 100%;
		object-fit: contain;
	}

	& figcaption {
		font-size: 1rem;
	}
}
</style>
