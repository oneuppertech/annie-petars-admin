<script setup lang="ts">
import { ref, watch, onMounted, onBeforeUnmount, computed } from 'vue'
import { RouterLink, useRoute } from 'vue-router'
import logo from '@/assets/annie-peters-logo.png'
import { SHOP_URL } from '@/config/site'

const route = useRoute()
const open = ref(false)
const scrolled = ref(false)
const onScroll = () => (scrolled.value = window.scrollY > 40)

const isHomePage = computed(() => route.name === 'home')

const links = [
  { label: 'Collections', to: { name: 'collections' } },
  { label: 'Asana Kemuwa', to: { name: 'asana-kemuwa' } },
  { label: 'Custom Outfits', to: { name: 'custom' } },
  { label: 'Press', to: { name: 'press' } },
  { label: 'FAQ', to: { name: 'faq' } },
  // Only works if the contact section still lives on the home page
  { label: 'Contact', to: { name: 'contact' } }
]

watch(() => route.fullPath, () => (open.value = false))
onMounted(() => {
  window.addEventListener('scroll', onScroll, { passive: true })
  onScroll()
})
onBeforeUnmount(() => window.removeEventListener('scroll', onScroll))
</script>

<template>
  <header
    class="ap-header sticky top-0 z-50 bg-white transition-all duration-500"
    :class="scrolled ? 'shadow-[0_8px_30px_-12px_rgba(42,27,22,.18)] py-3' : 'py-5'"
  >
    <div class="mx-auto flex max-w-7xl items-center justify-between px-6">
      <RouterLink :to="{ name: 'home' }" aria-label="AnniePetars home">
        <img
          :src="logo"
          alt="AnniePetars"
          class="w-auto transition-all duration-500"
          :class="scrolled ? 'h-9' : 'h-11'"
        />
      </RouterLink>

      <nav class="hidden items-center gap-9 text-sm lg:flex" aria-label="Primary">
        <RouterLink v-for="l in links" :key="l.label" :to="l.to" class="link-u" active-class="is-active">
          {{ l.label }}
        </RouterLink>
      </nav>

      <div class="hidden items-center gap-3 lg:flex">
  <RouterLink
    v-if="!isHomePage"
    :to="{ name: 'home' }"
    class="btn-home"
  >
    <i class="fa-solid fa-arrow-left mr-2 text-xs"></i>
    Back to Home
  </RouterLink>

  <a :href="SHOP_URL" class="btn-peach">
    Shop now
    <i class="fa-solid fa-bag-shopping ml-2 text-xs"></i>
  </a>
</div>

      <button
        class="text-xl lg:hidden"
        :aria-expanded="open"
        aria-label="Menu"
        @click="open = !open"
      >
        <i :class="open ? 'fa-solid fa-xmark' : 'fa-solid fa-bars'"></i>
      </button>
    </div>

    <Transition name="drop">
      <nav v-if="open" class="mx-6 mt-4 rounded-3xl bg-white p-6 shadow-xl lg:hidden">
        <RouterLink v-for="l in links" :key="l.label" :to="l.to" class="block py-3 text-lg">
          {{ l.label }}
        </RouterLink>

        <RouterLink
  v-if="!isHomePage"
  :to="{ name: 'home' }"
  class="btn-home mt-3 w-full justify-center"
>
  <i class="fa-solid fa-arrow-left mr-2 text-xs"></i>
  Back to Home
</RouterLink>

<a :href="SHOP_URL" class="btn-peach mt-3 w-full justify-center">
  Shop now
</a>
      </nav>
    </Transition>
  </header>
</template>

<style scoped>
.btn-home {
  display: inline-flex;
  align-items: center;
  border: 1px solid #eadbd3;
  border-radius: 999px;
  padding: 0.85rem 1.3rem;
  font-weight: 600;
  font-size: 0.9rem;
  background: #fff;
  color: #2a1b16;
  transition:
    background 0.3s,
    border-color 0.3s,
    transform 0.3s;
}

.btn-home:hover {
  background: #fff4ed;
  border-color: #f59a6c;
  transform: translateY(-2px);
}
.ap-header { font-family: 'Manrope', system-ui, sans-serif; color: #2a1b16; }
.btn-peach {
  display: inline-flex; align-items: center; border-radius: 999px; padding: 0.85rem 1.6rem;
  font-weight: 600; font-size: 0.9rem; background: #f59a6c; color: #2a1b16;
  box-shadow: 0 10px 30px -10px rgba(226, 120, 74, 0.7);
  transition: transform 0.3s, background 0.3s;
}
.btn-peach:hover { background: #ffc4a3; transform: translateY(-3px); }
.link-u { position: relative; }
.link-u::after {
  content: ''; position: absolute; left: 0; bottom: -4px; height: 1.5px; width: 100%;
  background: currentColor; transform: scaleX(0); transform-origin: right; transition: transform 0.35s;
}
.link-u:hover::after, .link-u.is-active::after { transform: scaleX(1); transform-origin: left; }
.link-u.is-active { color: #c4623a; }
.drop-enter-active, .drop-leave-active { transition: all 0.35s; }
.drop-enter-from, .drop-leave-to { opacity: 0; transform: translateY(-10px); }
</style>