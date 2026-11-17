// Where you are in the capture tool, as a URL: the project, the painting open in the editor, colour calibration.
// App.vue follows the route (it is the only view): the routes only name places, they render nothing themselves.
import { createRouter, createWebHistory } from 'vue-router'

const none = { render: () => null }

export default createRouter({
	history: createWebHistory(),
	routes: [
		// no project in the URL: the bridge's current one
		{ path: '/', name: 'home', component: none },
		{ path: '/:project', name: 'project', component: none },
		{ path: '/:project/p/:id', name: 'painting', component: none },
		{ path: '/:project/calibrate-colour', name: 'colour', component: none },
	],
})
