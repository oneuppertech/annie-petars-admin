import { computed } from 'vue'
import { useAuthStore } from '@/stores/auth'

// Mirrors the permissions enforced by the orders edge function
const WRITE = ['owner', 'admin', 'order_manager']
const MONEY = ['owner', 'admin']

export function useOrderAccess() {
  const auth = useAuthStore()
  const role = computed(() => auth.role ?? '')
  return {
    role,
    canWrite: computed(() => WRITE.includes(role.value)),
    canMoney: computed(() => MONEY.includes(role.value))
  }
}