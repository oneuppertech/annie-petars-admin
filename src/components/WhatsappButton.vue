<script setup lang="ts">
import { WHATSAPP } from '@/config/site'
</script>

<template>
  <a
    :href="WHATSAPP"
    target="_blank"
    rel="noopener"
    aria-label="Chat on WhatsApp"
    class="wa fixed bottom-6 right-6 z-50 flex h-14 w-14 items-center justify-center rounded-full bg-[#25D366] text-3xl text-white shadow-xl"
  >
    <i class="fa-brands fa-whatsapp"></i>
  </a>
</template>

<style scoped>
.wa { animation: apPulse 2.4s infinite; }
@keyframes apPulse {
  0% { box-shadow: 0 0 0 0 rgba(37, 211, 102, 0.5); }
  70%, 100% { box-shadow: 0 0 0 18px rgba(37, 211, 102, 0); }
}
@media (prefers-reduced-motion: reduce) { .wa { animation: none; } }
</style>