<script setup>
import { computed } from 'vue'
const props = defineProps({ text: { type: String, required: true } })
// Splits out [bracketed placeholders] so they can be highlighted until filled in
const parts = computed(() =>
  props.text
    .split(/(\[[^\]]+\])/g)
    .filter(Boolean)
    .map((t) => ({ t, ph: /^\[[^\]]+\]$/.test(t) }))
)
</script>

<template>
  <template v-for="(p, i) in parts" :key="i">
    <mark v-if="p.ph" class="ph">{{ p.t }}</mark>
    <template v-else>{{ p.t }}</template>
  </template>
</template>

<style>
.ph {
  background: rgba(245, 154, 108, 0.28);
  color: inherit;
  border-radius: 0.375rem;
  padding: 0 0.3rem;
}
</style>