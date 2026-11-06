
import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import {
  supabase,
  initializeSupabaseAuth,
  getCurrentSession
} from '@/services/supabase'
const ADMIN_ROLES = [
  'owner',
  'admin',
  'catalog_manager',
  'order_manager'
]

export const useAuthStore = defineStore('auth', () => {
  const session = ref<any>(null)
  const role = ref<string | null>(null)
  const loading = ref(false)
  const initialized = ref(false)

  let initPromise: Promise<void> | null = null
  let authSubscription: { unsubscribe: () => void } | null = null

  const user = computed(() => session.value?.user ?? null)

  const token = computed(() => session.value?.access_token ?? null)

  const isAdmin = computed(
    () => !!user.value && ADMIN_ROLES.includes(role.value ?? '')
  )

  async function fetchRole() {
    const currentUserId = user.value?.id

    if (!currentUserId) {
      role.value = null
      return
    }

    const { data, error } = await supabase
      .from('user_roles')
      .select('role')
      .eq('user_id', currentUserId)
      .maybeSingle()

    if (error) {
      console.error('Failed to fetch user role:', error)
      throw error
    }

    // Do not assign a stale role if the user changed.
    if (user.value?.id === currentUserId) {
      role.value = data?.role ?? null
    }
  }

  async function init() {
    if (initPromise) return initPromise

    initPromise = (async () => {
      await initializeSupabaseAuth()

      session.value = getCurrentSession()

      if (session.value) {
        await fetchRole()
      }

      if (!authSubscription) {
        const { data: listener } = supabase.auth.onAuthStateChange(
          (event, newSession) => {
            const previousUserId = session.value?.user?.id
            const nextUserId = newSession?.user?.id

            session.value = newSession

            if (!newSession) {
              role.value = null
              return
            }

            // Refresh the role only when identity changes or a user signs in.
            if (
              event === 'SIGNED_IN' ||
              event === 'USER_UPDATED' ||
              previousUserId !== nextUserId
            ) {
              setTimeout(() => {
                void fetchRole().catch(console.error)
              }, 0)
            }
          }
        )

        authSubscription = listener.subscription
      }

      initialized.value = true
    })().catch((error) => {
      initPromise = null
      console.error('Auth initialization failed:', error)
      throw error
    })

    return initPromise
  }

  async function login(email: string, password: string) {
    loading.value = true

    try {
      const { data, error } = await supabase.auth.signInWithPassword({
        email,
        password
      })

      if (error) {
        throw new Error(
          /invalid login/i.test(error.message)
            ? 'Incorrect email or password'
            : error.message
        )
      }

      session.value = data.session

      await fetchRole()

      if (!isAdmin.value) {
        await logout()
        throw new Error('This account does not have admin access')
      }
    } finally {
      loading.value = false
    }
  }

  async function logout() {
    const { error } = await supabase.auth.signOut()

    if (error) {
      console.error('Logout failed:', error)
      throw error
    }

    session.value = null
    role.value = null
  }

  return {
    session,
    role,
    loading,
    initialized,
    user,
    token,
    isAdmin,
    init,
    login,
    logout,
    fetchRole
  }
})
