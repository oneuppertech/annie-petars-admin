
<script setup>
import { computed } from 'vue'
import { RouterLink } from 'vue-router'
import sidebarItems from './sidebarItems'
import { useAuthStore } from '@/stores/auth'

defineEmits(['navigate'])

const authStore = useAuthStore()

// Use the role from the Supabase Pinia auth store.
const userRole = computed(() => authStore.role?.toLowerCase() || null)

// All admin roles can access every sidebar navigation item.
const hasAdminAccess = computed(() => authStore.isAdmin)

// No individual role-based filtering is required.
const visibleSidebarItems = computed(() =>
  hasAdminAccess.value ? sidebarItems : []
)
</script>

<template>
  <div class="flex h-full flex-col bg-white">

    <!-- Logo -->
    <div class="flex h-[76px] shrink-0 items-center px-6">
      <RouterLink
        to="/dashboard"
        class="flex items-center gap-3"
        @click="$emit('navigate')"
      >
        <!-- Add your logo here -->
      </RouterLink>
    </div>

    <!-- Navigation -->
    <nav class="sidebar-scroll flex-1 overflow-y-auto px-4 py-4">
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

  </div>
</template>

<style scoped>
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
