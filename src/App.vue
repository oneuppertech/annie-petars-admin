<script setup lang="ts">
import { RouterView } from 'vue-router'
const defaults = {
  VTextField: { variant: 'outlined', color: 'primary', baseColor: '#FFC4A3', density: 'comfortable' },
  VTextarea: { variant: 'outlined', color: 'primary', baseColor: '#FFC4A3' },
  VSelect: { variant: 'outlined', color: 'primary', baseColor: '#FFC4A3', density: 'comfortable' },
  VCombobox: { variant: 'outlined', color: 'primary', baseColor: '#FFC4A3', density: 'comfortable' },
  VAutocomplete: { variant: 'outlined', color: 'primary', baseColor: '#FFC4A3', density: 'comfortable' }
}

import WhatsAppButton from '@/components/WhatsappButton.vue'
</script>

<template>
  <div class="ap">
   
    <main>
      <RouterView />
    </main>
  
    <WhatsAppButton />
  </div>
</template>

<style>
@import url('https://fonts.googleapis.com/css2?family=Fraunces:ital,opsz,wght@0,9..144,300;0,9..144,400;1,9..144,300;1,9..144,400&family=Manrope:wght@400;500;600&display=swap');

.v-btn {
  text-transform: none;
}
</style>