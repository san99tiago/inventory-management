import { createApp } from 'vue'
import { createRouter, createWebHistory, createWebHashHistory } from 'vue-router'
import { DEMO_MODE } from './api'
import App from './App.vue'
import Dashboard from './views/Dashboard.vue'
import Inventory from './views/Inventory.vue'
import Orders from './views/Orders.vue'
import Demand from './views/Demand.vue'
import Spending from './views/Spending.vue'
import Reports from './views/Reports.vue'
import Restocking from './views/Restocking.vue'

const router = createRouter({
  // 2026-11-12: GitHub Pages cannot serve deep links in history mode (a refresh on
  // /inventory returns 404), so demo mode uses hash URLs (#/inventory).
  history: DEMO_MODE ? createWebHashHistory() : createWebHistory(),
  routes: [
    { path: '/', component: Dashboard },
    { path: '/inventory', component: Inventory },
    { path: '/orders', component: Orders },
    { path: '/demand', component: Demand },
    { path: '/restocking', component: Restocking },
    { path: '/spending', component: Spending },
    { path: '/reports', component: Reports }
  ]
})

const app = createApp(App)
app.use(router)
app.mount('#app')
