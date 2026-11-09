import { createRouter, createWebHistory } from 'vue-router'
import LandingPage from '../views/LandingPage.vue'

const router = createRouter({
  history: createWebHistory(import.meta.env.BASE_URL),

  routes: [
    {
      path: '/',
      name: 'admin-login',
      component: () => import('@/views/admin/LoginView.vue'),
      meta: { guestOnly: true }
    },
    {
      path: '/admin/inventory',
      component: () => import('@/views/admin/InventoryView.vue'),
      meta: { requiresAdmin: true }
    },
    {
      path: '/admin/dashboard',
      component: () => import('@/views/admin/Dashboard.vue'),
      meta: { requiresAdmin: true }
    },
    {
      path: '/admin/orders',
      component: () => import('@/views/admin/OrdersView.vue'),
      meta: { requiresAdmin: true }
    },
    {
      path: '/admin/orders/:id',
      component: () => import('@/views/admin/OrdersDetails.vue'),
      meta: { requiresAdmin: true }
    }
  ],
  scrollBehavior(to, from, savedPosition) {
    if (savedPosition) {
      return savedPosition
    }

    return {
      top: 0,
      left: 0,
      behavior: 'smooth'
    }
  }
})

export default router
import { useAuthStore } from '@/stores/auth'

router.beforeEach(async (to) => {
  const auth = useAuthStore()
  await auth.init()
  if (to.meta.requiresAdmin && !auth.isAdmin)
    return { name: 'admin-login', query: { redirect: to.fullPath } }
  if (to.meta.guestOnly && auth.isAdmin) return '/admin/dashboard'
})
