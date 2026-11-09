<script setup lang="ts">
import { ICONS } from '@/utils/icons'
withDefaults(defineProps<{ name: string; size?: number }>(), { size: 16 })
</script>

<template>
  <svg
    :width="size"
    :height="size"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    stroke-width="2"
    stroke-linecap="round"
    stroke-linejoin="round"
    aria-hidden="true"
    style="flex-shrink: 0"
  >
    <path :d="ICONS[name]" />
  </svg>
</template>
