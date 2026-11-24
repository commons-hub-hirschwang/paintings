import { createRouter, createWebHistory } from 'vue-router'
import GalleryView from '../views/GalleryView.vue'

// where the gallery was scrolled to when a painting was opened, restored on return (also via the "← Gallery" link)
let galleryScroll = 0

const router = createRouter({
	history: createWebHistory(import.meta.env.BASE_URL),
	routes: [
		{ path: '/', name: 'gallery', component: GalleryView },
		{ path: '/p/:id', name: 'painting', component: () => import('../views/PaintingView.vue') },
		{ path: '/rate', name: 'rate', component: () => import('../views/RateView.vue') },
		{ path: '/admin', name: 'admin', component: () => import('../views/AdminView.vue') },
		{ path: '/password', name: 'password', component: () => import('../views/PasswordView.vue') },
	],
	scrollBehavior(to, from, savedPosition) {
		if (savedPosition) return savedPosition
		if (to.name === 'gallery') return { top: galleryScroll }
		// previous / next painting: stay where you are
		if (to.name === 'painting' && from.name === 'painting') return false
		return { top: 0 }
	},
})

router.beforeEach((_to, from) => {
	if (from.name === 'gallery') galleryScroll = window.scrollY
})

// back to where the gallery was (its scroll position) when coming from it, else open it ("← Gallery", Esc)
export function backToGallery() {
	if (history.state?.back === '/') router.back()
	else router.push('/')
}

export default router
