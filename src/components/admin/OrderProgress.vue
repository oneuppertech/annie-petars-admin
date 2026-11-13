<script setup lang="ts">
import { computed } from 'vue'
const props = defineProps<{ status: string; method?: string }>()
const steps = computed(() =>
  props.method === 'pickup'
    ? ['paid', 'processing', 'ready_to_ship', 'delivered']
    : ['paid', 'processing', 'ready_to_ship', 'shipped', 'delivered']
)
const labels: Record<string, string> = {
  paid: 'Paid', processing: 'Processing', ready_to_ship: props.method === 'pickup' ? 'Ready for pickup' : 'Ready to ship',
  shipped: 'Shipped', delivered: 'Delivered'
}
const idx = computed(() => steps.value.indexOf(props.status))
const closed = computed(() => ['cancelled', 'refunded'].includes(props.status))
</script>

<template>
  <ol v-if="!closed && props.status !== 'pending_payment'" class="mb-4 flex items-center gap-1 text-[12px]">
    <li v-for="(s, i) in steps" :key="s" class="flex flex-1 flex-col items-center gap-1 text-center">
      <span class="h-1.5 w-full rounded-full" :style="{ background: i <= idx ? 'var(--ink)' : 'var(--line)' }"></span>
      <span :style="{ opacity: i <= idx ? 1 : 0.5 }">{{ labels[s] }}</span>
    </li>
  </ol>
</template>