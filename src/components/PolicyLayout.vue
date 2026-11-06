<script setup>
import { computed, onMounted } from 'vue'
import { RouterLink, useRoute } from 'vue-router'
import AOS from 'aos'
import 'aos/dist/aos.css'
import PlaceholderText from '@/components/PlaceholderText.vue'

const props = defineProps({
  title: { type: String, required: true },
  icon: { type: String, required: true },
  intro: { type: String, default: '' },
  sections: { type: Array, required: true }, // [{ id, title, icon, blocks: [{ type: 'p'|'ul', text|items, lead? }] }]
  closing: { type: String, default: '' }
})

const route = useRoute()
const allPolicies = [
  { name: 'privacy-policy', label: 'Privacy Policy', icon: 'fa-solid fa-lock' },
  { name: 'cookie-policy', label: 'Cookie Policy', icon: 'fa-solid fa-cookie-bite' },
  { name: 'terms', label: 'Website Terms and Conditions', icon: 'fa-solid fa-file-contract' }
]
const related = computed(() => allPolicies.filter((p) => p.name !== route.name))

const lead = (item) => {
  const i = item.indexOf(':')
  return i === -1 ? { head: '', rest: item } : { head: item.slice(0, i + 1), rest: item.slice(i + 1) }
}
const jump = (id) => document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' })

onMounted(() => {
  AOS.init({
    duration: 900,
    easing: 'ease-out-cubic',
    once: true,
    offset: 80,
    disable: () => window.matchMedia('(prefers-reduced-motion: reduce)').matches
  })
})
</script>

<template>
  <div class="ap bg-[#FFF7F1] text-[#2A1B16] antialiased overflow-x-hidden">
    <!-- HERO -->
    <section class="relative overflow-hidden pb-16 pt-20 md:pt-28">
      <div class="blob blob-a"></div>
      <div class="blob blob-b"></div>
      <div class="relative mx-auto max-w-7xl px-6">
        <span
          class="rise mb-6 flex h-16 w-16 items-center justify-center rounded-full bg-[#FFC4A3] text-2xl"
          style="--d: 0.1s"
          ><i :class="icon"></i
        ></span>
        <h1 class="font-display text-[clamp(2.6rem,7vw,6rem)] leading-[.98] tracking-tight">
          <span class="block overflow-hidden"
            ><span class="rise-line" style="--d: 0.2s">{{ title }}</span></span
          >
        </h1>
        <p
          v-if="intro"
          class="rise mt-8 max-w-2xl text-lg leading-relaxed text-[#5A413A]"
          style="--d: 0.5s"
        >
          <PlaceholderText :text="intro" />
        </p>
      </div>
    </section>

    <!-- CONTENT -->
    <section class="mx-auto max-w-7xl px-6 pb-24">
      <div class="grid gap-12 lg:grid-cols-12">
        <!-- Section index -->
        <aside class="hidden lg:col-span-3 lg:block" aria-label="On this page">
          <nav class="sticky top-28 space-y-1">
            <button
              v-for="s in sections"
              :key="s.id"
              type="button"
              class="idx flex w-full items-center gap-3 rounded-2xl px-4 py-3 text-left text-sm"
              @click="jump(s.id)"
            >
              <i :class="s.icon" class="w-4 text-[#E2784A]"></i>{{ s.title }}
            </button>
          </nav>
        </aside>

        <div class="space-y-6 lg:col-span-9">
          <article
            v-for="(s, i) in sections"
            :id="s.id"
            :key="s.id"
            class="scroll-mt-28 rounded-3xl border border-[#2A1B16]/10 bg-white/60 p-7 transition hover:bg-[#FFE6D6] md:p-10"
            data-aos="fade-up"
            :data-aos-delay="(i % 2) * 100"
          >
            <div class="mb-5 flex items-center gap-4">
              <span class="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-[#FFC4A3] text-lg"
                ><i :class="s.icon"></i
              ></span>
              <h2 class="font-display text-3xl leading-tight md:text-4xl">{{ s.title }}</h2>
            </div>

            <template v-for="(b, j) in s.blocks" :key="j">
              <p v-if="b.type === 'p'" class="mt-4 leading-relaxed text-[#5A413A]">
                <PlaceholderText :text="b.text" />
              </p>
              <ul v-else class="mt-4 space-y-3">
                <li v-for="it in b.items" :key="it" class="flex gap-3 text-[#5A413A]">
                  <i class="fa-solid fa-circle-check mt-1 text-[#E2784A]"></i>
                  <span v-if="b.lead">
                    <strong class="font-semibold text-[#2A1B16]">{{ lead(it).head }}</strong>
                    <PlaceholderText :text="lead(it).rest" />
                  </span>
                  <span v-else><PlaceholderText :text="it" /></span>
                </li>
              </ul>
            </template>
          </article>

          <div
            v-if="closing"
            class="flex gap-5 rounded-3xl bg-[#2A1B16] p-7 text-[#FFD9C2] md:p-10"
            data-aos="zoom-in"
          >
            <span class="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-[#FFC4A3] text-lg text-[#2A1B16]"
              ><i class="fa-regular fa-envelope"></i
            ></span>
            <p class="leading-relaxed"><PlaceholderText :text="closing" /></p>
          </div>
        </div>
      </div>
    </section>

    <!-- OTHER POLICIES -->
    <section class="bg-[#FFE6D6] py-16">
      <div class="mx-auto grid max-w-7xl gap-5 px-6 sm:grid-cols-2">
        <RouterLink
          v-for="(p, i) in related"
          :key="p.name"
          :to="{ name: p.name }"
          class="group flex items-center gap-5 rounded-3xl bg-[#FFF7F1] p-7 transition hover:-translate-y-1"
          data-aos="fade-up"
          :data-aos-delay="i * 100"
        >
          <span class="flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl bg-[#FFC4A3] text-xl transition group-hover:rotate-6"
            ><i :class="p.icon"></i
          ></span>
          <span class="font-display text-2xl">{{ p.label }}</span>
          <i class="fa-solid fa-arrow-right ml-auto text-[#E2784A] transition group-hover:translate-x-1"></i>
        </RouterLink>
      </div>
    </section>
  </div>
</template>

<style>
.ap { font-family: 'Manrope', system-ui, sans-serif; }
.ap .font-display { font-family: 'Fraunces', Georgia, serif; font-weight: 300; }
.ap :focus-visible { outline: 2px solid #e2784a; outline-offset: 3px; }

.ap .idx { transition: background 0.25s, transform 0.25s; }
.ap .idx:hover { background: #ffe6d6; transform: translateX(4px); }

.ap .rise {
  opacity: 0; transform: translateY(28px);
  animation: apRise 1s cubic-bezier(0.2, 0.8, 0.2, 1) forwards; animation-delay: var(--d, 0s);
}
.ap .rise-line {
  display: inline-block; transform: translateY(110%);
  animation: apLine 1.1s cubic-bezier(0.2, 0.8, 0.2, 1) forwards; animation-delay: var(--d, 0s);
}
@keyframes apRise { to { opacity: 1; transform: none; } }
@keyframes apLine { to { transform: none; } }

.ap .blob { position: absolute; border-radius: 50%; filter: blur(70px); opacity: 0.7; animation: apDrift 14s ease-in-out infinite alternate; }
.ap .blob-a { width: 28rem; height: 28rem; background: #ffc4a3; top: -8rem; right: -8rem; }
.ap .blob-b { width: 20rem; height: 20rem; background: #ffe0cc; bottom: -2rem; left: -6rem; animation-delay: -6s; }
@keyframes apDrift { to { transform: translate(40px, 30px) scale(1.15); } }

@media (prefers-reduced-motion: reduce) {
  .ap *, .ap *::before, .ap *::after {
    animation-duration: 0.01ms !important; animation-iteration-count: 1 !important; transition-duration: 0.01ms !important;
  }
  .ap .rise, .ap .rise-line { opacity: 1; transform: none; }
}
</style>