<script setup>
import { ref, computed } from 'vue'
import { RouterLink, useRouter } from 'vue-router'
import sidebarItems from './sidebarItems'
import { useAuthStore } from '@/stores/auth'

const emit = defineEmits(['navigate'])

const authStore = useAuthStore()
const router = useRouter()

const loggingOut = ref(false)
const logoutError = ref('')


const userRole = computed(
  () => authStore.role?.toLowerCase() || null
)

const hasAdminAccess = computed(
  () => authStore.isAdmin
)

const visibleSidebarItems = computed(() => {
  if (!hasAdminAccess.value || !userRole.value) {
    return []
  }

  return sidebarItems
    .map(group => ({
      ...group,
      items: group.items.filter(item =>
        item.roles?.includes(userRole.value)
      )
    }))
    .filter(group => group.items.length > 0)
})
// User information
const userEmail = computed(
  () => authStore.user?.email || ''
)

const userName = computed(
  () =>
    authStore.user?.user_metadata?.full_name ||
    userEmail.value.split('@')[0] ||
    'Admin'
)

const userInitials = computed(() =>
  userName.value
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map(word => word.charAt(0))
    .join('')
    .toUpperCase()
)

const roleLabels = {
  owner: 'Store Owner',
  admin: 'Administrator',
  catalog_manager: 'Catalog Manager',
  order_manager: 'Order Manager',
  support: 'Support'
}

const roleLabel = computed(
  () => roleLabels[userRole.value] || 'Staff'
)

// Logout
async function handleLogout() {
  if (loggingOut.value) return

  loggingOut.value = true
  logoutError.value = ''

  try {
    await authStore.logout()

    emit('navigate')

    await router.replace('/')
  } catch (error) {
    console.error('Logout failed:', error)

    logoutError.value =
      'Unable to log out. Please try again.'
  } finally {
    loggingOut.value = false
  }
}
</script>

<template>
<div class="flex h-full min-h-0 flex-col overflow-hidden bg-white">

    <!-- Logo -->
    <div class="flex h-[76px] shrink-0 items-center px-6">
      <RouterLink
        to="/admin/dashboard"
        class="flex items-center gap-3"
        @click="$emit('navigate')"
      >
        <!-- Add your logo here -->
      </RouterLink>
    </div>

    <!-- Navigation -->
    <nav class="sidebar-scroll min-h-0 flex-1 overflow-y-auto px-4 py-4">
      <template v-if="hasAdminAccess">
        <div
          v-for="group in visibleSidebarItems"
          :key="group.section"
          class="mb-5"
        >
          <!-- Section heading -->
          <p
            class="mb-2 px-3 text-[10px] font-semibold uppercase tracking-[0.16em] text-[#B89A8C]"
          >
            {{ group.section }}
          </p>

          <div class="space-y-1">
            <RouterLink
              v-for="item in group.items"
              :key="item.to"
              :to="item.to"
              class="sidebar-link group flex items-center gap-3 rounded-md px-3 py-2.5 transition-all duration-200"
              active-class="sidebar-active"
              exact-active-class="sidebar-active"
              @click="$emit('navigate')"
            >
              <!-- Icon -->
              <div
                class="sidebar-icon flex h-8 w-8 shrink-0 items-center justify-center rounded-lg transition-all duration-200"
              >
                <i :class="item.icon" class="text-sm"></i>
              </div>

              <!-- Label -->
              <span
                class="min-w-0 flex-1 truncate text-[13px] font-medium transition-colors duration-200"
              >
                {{ item.label }}
              </span>

              <!-- Badge -->
              <span
                v-if="item.badge"
                class="sidebar-badge rounded-full px-2 py-0.5 text-[8px] font-bold"
              >
                {{ item.badge }}
              </span>
            </RouterLink>
          </div>
        </div>
      </template>
    </nav>
<!-- Sidebar Footer -->
<div
  v-if="hasAdminAccess"
  class="sidebar-footer shrink-0 border-t border-[#F0E4DD] bg-white px-4 py-4"
>
  <!-- User Profile -->
  <div class="mb-3 flex items-center gap-3 px-2">

    <!-- Avatar -->
    <div
      class="user-avatar flex h-10 w-10 shrink-0 items-center justify-center rounded-full"
    >
      {{ userInitials }}
    </div>

    <!-- User Details -->
    <div class="min-w-0 flex-1">
      <p
        class="truncate text-[13px] font-semibold text-[#5A413A]"
      >
        {{ userName }}
      </p>

      <p
        class="truncate text-[11px] text-[#9A7567]"
        :title="userEmail"
      >
        {{ userEmail }}
      </p>

      <p class="mt-0.5 text-[10px] font-medium text-[#C4623A]">
        {{ roleLabel }}
      </p>
    </div>
  </div>

  <!-- Logout Button -->
  <button
    type="button"
    class="logout-button group flex w-full items-center gap-3 rounded-lg px-3 py-2.5 transition-all duration-200"
    :disabled="loggingOut"
    @click="handleLogout"
  >
    <div
      class="logout-icon flex h-8 w-8 shrink-0 items-center justify-center rounded-lg"
    >
      <i
        v-if="loggingOut"
        class="fas fa-spinner fa-spin text-sm"
      ></i>

      <i
        v-else
        class="fas fa-sign-out-alt text-sm"
      ></i>
    </div>

    <span class="flex-1 text-left text-[13px] font-semibold">
      {{ loggingOut ? 'Logging out...' : 'Logout' }}
    </span>

    <i
      v-if="!loggingOut"
      class="fas fa-chevron-right text-[10px] opacity-60"
    ></i>
  </button>

  <!-- Error Message -->
  <p
    v-if="logoutError"
    role="alert"
    class="mt-2 px-2 text-xs text-red-600"
  >
    {{ logoutError }}
  </p>

  <!-- Copyright -->
  <p class="mt-4 text-center text-[10px] text-[#B89A8C]">
    © {{ new Date().getFullYear() }} Annie Petars
  </p>
</div>
  </div>
</template>

<style scoped>
/* ========================================
   SIDEBAR FOOTER
======================================== */

.sidebar-footer {
  flex-shrink: 0;
  margin-top: auto;
  background: #ffffff;
  border-top: 1px solid #f0e4dd;
}

/* User avatar */

.user-avatar {
  background: linear-gradient(
    135deg,
    #ffe6d6,
    #ffd5bf
  );
  color: #c4623a;
  font-size: 13px;
  font-weight: 700;
  border: 1px solid #f5cbb6;
}

/* Logout button */

.logout-button {
  background: #fff7f1;
  color: #c4623a;
  border: 1px solid transparent;
  cursor: pointer;
}

.logout-button:hover:not(:disabled) {
  background: #ffe6d6;
  border-color: #f5cbb6;
  color: #a94b28;
}

.logout-button:active:not(:disabled) {
  transform: scale(0.98);
}

.logout-button:disabled {
  opacity: 0.6;
  cursor: not-allowed;
}

/* Logout icon */

.logout-icon {
  background: #ffe6d6;
  color: #c4623a;
  transition: all 0.2s ease;
}

.logout-button:hover:not(:disabled) .logout-icon {
  background: linear-gradient(
    135deg,
    #e2784a,
    #c4623a
  );
  color: #ffffff;
  box-shadow: 0 4px 12px rgba(226, 120, 74, 0.22);
}
/* ========================================
   SIDEBAR SCROLLBAR
======================================== */

.sidebar-scroll {
  scrollbar-width: none;
  -ms-overflow-style: none;
}

.sidebar-scroll::-webkit-scrollbar {
  display: none;
}

/* ========================================
   DEFAULT NAVIGATION
======================================== */

.sidebar-link {
  background: transparent;
  color: #5A413A;
}

.sidebar-link:hover {
  background: #FFF7F1;
  color: #2A1B16;
}

/* ========================================
   DEFAULT ICON
======================================== */

.sidebar-icon {
  background: transparent;
  color: #9A7567;
}

.sidebar-link:hover .sidebar-icon {
  background: #FFE6D6;
  color: #E2784A;
}

/* ========================================
   ACTIVE NAVIGATION
======================================== */

.sidebar-active {
  background: #FFF1E8 !important;
  color: #C4623A !important;
}

.sidebar-active:hover {
  background: #FFF1E8 !important;
}

/* Active icon container */
.sidebar-active .sidebar-icon {
  background: linear-gradient(
    135deg,
    #E2784A,
    #C4623A
  ) !important;

  color: #FFFFFF !important;

  box-shadow: 0 4px 12px rgba(226, 120, 74, 0.22);
}

/* Active label */
.sidebar-active span {
  color: #C4623A !important;
  font-weight: 600;
}

/* ========================================
   NAVIGATION BADGE
======================================== */

.sidebar-badge {
  background: #FFE6D6;
  color: #C4623A;
}

/* ========================================
   TRANSITIONS
======================================== */

.sidebar-link,
.sidebar-icon,
.sidebar-badge {
  transition: all 0.2s ease;
}
</style>
