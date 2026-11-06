<script setup>
import { ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useAuthStore } from '@/stores/auth'

const auth = useAuthStore()
const route = useRoute()
const router = useRouter()

const email = ref('')
const password = ref('')
const showPw = ref(false)
const error = ref('')

async function submit() {
  error.value = ''
  try {
    await auth.login(email.value.trim(), password.value)
    const redirect = String(route.query.redirect || '')
    router.replace(redirect.startsWith('/admin') ? redirect : '/admin/inventory')
  } catch (e) {
    error.value = e.message || 'Unable to sign in'
  }
}
</script>

<template>
  <main class="flex min-h-screen items-center justify-center bg-[#FFF7F1] px-5 text-[#2A1B16]">
    <form class="w-full max-w-sm rounded-2xl bg-white p-8 shadow-sm" @submit.prevent="submit">
      <div class="mb-8 text-center">
        <span class="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-[#FFE6D6] text-sm font-semibold">AP</span>
        <h1 class="mt-4 text-xl font-semibold">Admin sign in</h1>
        <p class="mt-1 text-sm text-[#5A413A]">AnniePetars inventory</p>
      </div>

      <label class="mb-1 block text-xs font-medium text-[#5A413A]" for="email">Email</label>
      <input id="email" v-model="email" type="email" required autocomplete="username"
        class="mb-4 w-full rounded-lg border border-black/15 px-3 py-2.5 text-sm outline-none transition focus:border-[#E2784A]" />

      <label class="mb-1 block text-xs font-medium text-[#5A413A]" for="password">Password</label>
      <div class="relative mb-5">
        <input id="password" v-model="password" :type="showPw ? 'text' : 'password'" required autocomplete="current-password"
          class="w-full rounded-lg border border-black/15 py-2.5 pl-3 pr-14 text-sm outline-none transition focus:border-[#E2784A]" />
        <button type="button" class="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-[#5A413A]" @click="showPw = !showPw">
          {{ showPw ? 'Hide' : 'Show' }}
        </button>
      </div>

      <p v-if="error" class="mb-4 rounded-lg bg-red-50 px-3 py-2 text-sm text-[#B63C34]" role="alert">{{ error }}</p>

      <button type="submit" :disabled="auth.loading || !email || !password"
        class="w-full rounded-lg bg-[#2A1B16] py-3 text-sm font-semibold text-white transition hover:bg-[#E2784A] disabled:pointer-events-none disabled:opacity-50">
        {{ auth.loading ? 'Signing in…' : 'Sign in' }}
      </button>
    </form>
  </main>
</template>