import {createApp} from 'vue'
import {createRouter, createWebHistory} from 'vue-router'
import App from './App.vue'
import './style.css'
import './table.css'

const routes = [
  {path: '/', component: () => import('./views/Home.vue')},
  {path: '/invite/:code', component: () => import('./views/Home.vue')},
  {path: '/room/:id', component: () => import('./views/Room.vue')},
  {path: '/room/:id/display', component: () => import('./views/RoomDisplay.vue')},
  {path: '/local', component: () => import('./views/LocalTable.vue')},
]
const router = createRouter({history: createWebHistory(import.meta.env.BASE_URL), routes})
createApp(App).use(router).mount('#app')
router.isReady().then(() => {
  document.documentElement.dataset.appMounted = '1'
  document.getElementById('boot-error')?.remove()
}).catch(() => {
  const error = document.getElementById('boot-error')
  if (error) error.style.display = 'block'
})
