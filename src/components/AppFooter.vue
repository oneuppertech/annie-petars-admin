<script setup lang="ts">
import { reactive } from 'vue'
import { RouterLink } from 'vue-router'
import logo from '@/assets/annie-peters-logo.png'
import { WHATSAPP, EMAIL } from '@/config/site'

const news = reactive({ email: '', done: false })
const joinNews = () => {
  if (!news.email) return
  // TODO: wire to mailing list
  news.done = true
}

const pages = [
  { label: 'Collections', to: { name: 'collections' } },
  { label: 'Asana Kemuwa', to: { name: 'asana-kemuwa' } },
  { label: 'Custom Outfits', to: { name: 'custom' } },
  { label: 'Press', to: { name: 'press' } },
  { label: 'FAQ', to: { name: 'faq' } }
]
// Add a `to` as each policy page is built; items without one stay as placeholders
const legal = [
  { label: 'Privacy Policy', to: { name: 'privacy-policy' } },
  { label: 'Cookie Policy', to: { name: 'cookie-policy' } },
  { label: 'Website Terms and Conditions', to: { name: 'terms' } },
  { label: 'Delivery and Shipping' },
  { label: 'Returns and Refunds' },
  { label: 'Customisation Terms' },
  { label: 'Accessibility Statement' }
]
</script>

<template>
  <footer class="ap-footer bg-[#FFC4A3] pt-20">
    <div class="mx-auto max-w-7xl px-6">
      <div class="grid items-center gap-8 pb-16 lg:grid-cols-2">
        <div>
          <h2 class="font-display text-4xl md:text-5xl">Be part of the AnniePetars story</h2>
          <p class="mt-3 max-w-md text-sm">
            Selected updates on collections, projects and events. Unsubscribe anytime. See our
            Privacy Policy.
          </p>
        </div>
        <form class="flex gap-2 rounded-full bg-white p-2" @submit.prevent="joinNews">
          <input
            v-model="news.email"
            type="email"
            class="min-w-0 flex-1 bg-transparent px-4 outline-none"
            placeholder="Enter your email address"
            aria-label="Email address"
          />
          <button class="btn-dark">{{ news.done ? 'Joined' : 'Join our mailing list' }}</button>
        </form>
      </div>

      <div class="flex flex-wrap items-center justify-between gap-6 border-t border-[#2A1B16]/20 py-8 text-sm">
        <RouterLink :to="{ name: 'home' }" class="rounded-2xl bg-white px-5 py-3" aria-label="AnniePetars home">
          <img :src="logo" alt="AnniePetars" class="h-10 w-auto" />
        </RouterLink>
        <p class="max-w-sm">
          Celebrating African heritage through contemporary fashion, distinctive design and
          individual expression.
        </p>
        <div class="flex gap-5 text-xl">
          <a :href="WHATSAPP" target="_blank" rel="noopener" aria-label="WhatsApp"><i class="fa-brands fa-whatsapp"></i></a>
          <a :href="`mailto:${EMAIL}`" aria-label="Email"><i class="fa-regular fa-envelope"></i></a>
        </div>
      </div>

      <nav class="flex flex-wrap gap-x-6 gap-y-2 border-t border-[#2A1B16]/20 py-6 text-sm" aria-label="Site">
        <RouterLink v-for="p in pages" :key="p.label" :to="p.to" class="link-u">{{ p.label }}</RouterLink>
      </nav>
      <nav class="flex flex-wrap gap-x-6 gap-y-2 pb-10 text-xs" aria-label="Legal">
        <template v-for="l in legal" :key="l.label">
          <RouterLink v-if="l.to" :to="l.to" class="link-u">{{ l.label }}</RouterLink>
          <a v-else href="#" class="link-u">{{ l.label }}</a>
        </template>
      </nav>
    </div>
  </footer>
</template>

<style scoped>
.ap-footer { font-family: 'Manrope', system-ui, sans-serif; color: #2a1b16; }
.font-display { font-family: 'Fraunces', Georgia, serif; font-weight: 300; }
.btn-dark {
  display: inline-flex; align-items: center; border-radius: 999px; padding: 0.85rem 1.6rem;
  font-weight: 600; font-size: 0.9rem; background: #2a1b16; color: #fff7f1; transition: background 0.3s;
}
.btn-dark:hover { background: #e2784a; }
.link-u { position: relative; }
.link-u::after {
  content: ''; position: absolute; left: 0; bottom: -4px; height: 1.5px; width: 100%;
  background: currentColor; transform: scaleX(0); transform-origin: right; transition: transform 0.35s;
}
.link-u:hover::after { transform: scaleX(1); transform-origin: left; }
</style>