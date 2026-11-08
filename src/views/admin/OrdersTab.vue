<script setup lang="ts">
import { computed } from 'vue'
import { imageUrl } from '@/api'
import { sizeLabel } from '../../../shared/types'
import { eur, paintings } from './state'

const orders = computed(() => paintings.value.filter((p) => p.deleted_at === null && (p.status === 'reserved' || p.status === 'sold')))
</script>

<template>
	<section>
		<h2>Orders ({{ orders.length }})</h2>
		<p class="muted">Buyer, address and payment are in Stripe. Reserved: someone is paying right now, for up to 31 minutes.</p>
		<table>
			<thead>
				<tr>
					<th></th>
					<th>Stack</th>
					<th>#</th>
					<th>Name</th>
					<th>Size (cm)</th>
					<th>Price now</th>
					<th>Status</th>
				</tr>
			</thead>
			<tbody>
				<tr v-for="painting in orders" :key="painting.id">
					<td>
						<img v-if="painting.variants_version" :src="imageUrl(painting, 'thumb')" :alt="painting.title" loading="lazy" />
					</td>
					<td>{{ painting.stack }}</td>
					<td>{{ painting.number }}</td>
					<td>{{ painting.title || 'Untitled' }}</td>
					<td>{{ sizeLabel(painting) }}</td>
					<td>{{ eur(painting.price) }}</td>
					<td>{{ painting.status }}</td>
				</tr>
			</tbody>
		</table>
	</section>
</template>
