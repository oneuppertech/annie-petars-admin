<template>
  <header class="bg-white shadow-sm relative">
    <div class="mx-auto flex items-center justify-between px-6 py-4">
      <!-- Logo -->
      <div @click="goHome" class="flex items-center gap-2 cursor-pointer">
        <img :src="logo" alt="Logo" class="w-32 h-auto" />
      </div>

      <!-- Desktop Nav -->
      <nav class="hidden md:flex items-center gap-8 text-md">
        <router-link
          v-for="link in links"
          :key="link.path"
          :to="link.path"
          class="text-gray-800 hover:text-purple-600 transition-colors duration-200"
          exact-active-class="text-purple-600 font-semibold"
        >
          {{ link.label }}
        </router-link>
      </nav>

      <!-- User Info & Logout (desktop only) -->
      <div class="hidden md:flex items-center gap-4">
        <span class="text-md font-semibold">{{ fullName }}</span>
        <button
          @click="handleLogout"
          class="text-red-500 hover:text-red-600 font-medium transition-colors duration-200"
        >
          Logout
        </button>
      </div>

      <!-- Mobile Hamburger -->
      <button class="md:hidden text-gray-800" @click="showMenu = !showMenu">
        <svg
          v-if="!showMenu"
          xmlns="http://www.w3.org/2000/svg"
          class="w-6 h-6"
          fill="none"
          stroke="currentColor"
          stroke-width="2"
        >
          <path stroke-linecap="round" stroke-linejoin="round" d="M4 6h16M4 12h16M4 18h16" />
        </svg>
        <svg
          v-else
          xmlns="http://www.w3.org/2000/svg"
          class="w-6 h-6"
          fill="none"
          stroke="currentColor"
          stroke-width="2"
        >
          <path stroke-linecap="round" stroke-linejoin="round" d="M6 18L18 6M6 6l12 12" />
        </svg>
      </button>
    </div>

    <!-- Mobile Menu -->
    <transition name="slide-down">
      <div
        v-if="showMenu"
        class="absolute top-full left-0 w-full bg-white border-t shadow-md md:hidden z-50"
      >
        <nav class="flex flex-col space-y-4 p-4 text-gray-800 font-medium">
          <router-link
            v-for="link in links"
            :key="link.path"
            :to="link.path"
            class="mobile-link text-gray-800 hover:text-purple-600 transition-colors duration-200"
            exact-active-class="text-purple-600 font-semibold"
            @click="showMenu = false"
          >
            {{ link.label }}
          </router-link>

          <div class="pt-4">
            <v-btn color="red" size="large" rounded="lg" class="px-6 w-full" @click="handleLogout">
              Logout
            </v-btn>
          </div>
        </nav>
      </div>
    </transition>
  </header>
</template>

<script setup>
import { ref, computed } from 'vue'
import { useAuthStore } from '@/stores/auth'
import { useRouter } from 'vue-router'
import logo from '@/assets/images/new-logo.jpeg'

const showMenu = ref(false)
const authStore = useAuthStore()
const router = useRouter()

// Navigation links
const links = [
  { path: '/dashboard', label: 'Dashboard' },
  { path: '/apply-loan', label: 'Apply for Loan' },
  { path: '/repayment', label: 'Repayments' }
]

const goHome = () => {
  router.push('/dashboard')
}

const fullName = computed(() => {
  if (!authStore.user) return 'User'
  return `${authStore.user.first_name || ''} ${authStore.user.last_name || ''}`.trim()
})

const handleLogout = async () => {
  await authStore.logout()
  router.push('/login')
}
</script>

<style scoped>
/* Mobile dropdown slide down */
.slide-down-enter-active,
.slide-down-leave-active {
  transition: all 0.35s ease;
}
.slide-down-enter-from,
.slide-down-leave-to {
  opacity: 0;
  transform: translateY(-20px);
}
.slide-down-enter-to,
.slide-down-leave-from {
  opacity: 1;
  transform: translateY(0);
}

/* Mobile link padding */
.mobile-link {
  padding: 0.5rem 0;
}

/* Optional: smoother hover for desktop nav */
nav a {
  transition: color 0.2s ease;
}
.v-btn {
  text-transform: none;
}
</style>
