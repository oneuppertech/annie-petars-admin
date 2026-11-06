<script setup>
import { ref } from 'vue'
import { useDisplay } from 'vuetify'

import SidebarView from './Sidebar.vue'
import HeaderView from './HeaderView.vue'

const drawer = ref(true)

const { mdAndUp } = useDisplay()
</script>

<template>
  <v-app>
    <!-- Sidebar -->
    <v-navigation-drawer
      v-model="drawer"
      :permanent="mdAndUp"
      :temporary="!mdAndUp"
      width="250"
      elevation="0"
      class="side-bar"
    >
      <SidebarView @navigate="!mdAndUp && (drawer = false)" />
    </v-navigation-drawer>

    <!-- Header -->
    <v-app-bar
      app
      elevation="0"
      height="76"
      class="main-header"
    >
      <!-- Mobile menu -->
      <v-btn
        v-if="!mdAndUp"
        icon
        variant="text"
        class=""
        @click="drawer = !drawer"
      >
        <i class="fa-solid fa-bars text-sm text-gray-600"></i>
      </v-btn>

      

      <v-spacer />

     
    </v-app-bar>

    <!-- Main -->
    <v-main class="page-wrapper">
      <v-container
        fluid
        class="min-h-full pa-0"
      >
        <slot />
      </v-container>
    </v-main>
  </v-app>
</template>

<style scoped>
.side-bar {
  overflow: hidden !important;
  border-right: 1px solid #ede9fe !important;
}

.side-bar::-webkit-scrollbar {
  display: none;
}

.main-header {
  background: rgba(255, 255, 255, 0.9) !important;
  backdrop-filter: blur(18px);
  border-bottom: 1px solid #ede9fe !important;
  
}

.page-wrapper {
  background: #faf9ff;
  min-height: 100vh;
}
</style>