import { createRouter, createWebHistory } from 'vue-router'
import GalleryView from '../views/GalleryView.vue'

export default createRouter({
	history: createWebHistory(import.meta.env.BASE_URL),
	routes: [
		{ path: '/', name: 'gallery', component: GalleryView },
		{ path: '/rate', name: 'rate', component: () => import('../views/RateView.vue') },
		{ path: '/admin', name: 'admin', component: () => import('../views/AdminView.vue') },
	],
})
