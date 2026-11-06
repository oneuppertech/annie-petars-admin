<script setup>
import { ref, provide, onMounted } from 'vue'
import { inventoryApi, errMsg } from '@/services/inventory'
import ProductsPanel from '@/components/admin/inventory/ProductsPanel.vue'
import CollectionsPanel from '@/components/admin/inventory/CollectionsPanel.vue'
import StockPanel from '@/components/admin/inventory/StockPanel.vue'
import MainLayout from '@/layouts/MainLayout.vue'

const tab = ref('products')
const collections = ref([])
const snack = ref({ show: false, text: '', color: 'success' })

const notify = (text, color = 'success') => (snack.value = { show: true, text, color })
provide('notify', notify)

async function loadCollections() {
  try {
    collections.value = (await inventoryApi.collections()).collections
    console.log("collections:", collections.value)
  } catch (e) {
    console.log("error loading:", e)
    notify(errMsg(e), 'error')
  }
}
onMounted(loadCollections)
</script>

<template>
  <MainLayout>
       <div class="mx-auto p-4 md:p-6">

    <v-tabs v-model="tab" class="peach-tabs mb-6">
  <v-tab value="products">Products</v-tab>
  <v-tab value="collections">Collections</v-tab>
  <v-tab value="stock">Stock alerts</v-tab>
</v-tabs>

    <ProductsPanel v-if="tab === 'products'" :collections="collections" @changed="loadCollections" />
    <CollectionsPanel v-else-if="tab === 'collections'" :collections="collections" @changed="loadCollections" />
    <StockPanel v-else />

    <v-snackbar v-model="snack.show" :color="snack.color" timeout="3000">{{ snack.text }}</v-snackbar>
  </div>
  </MainLayout>
 
</template>

<style scoped>
.peach-tabs {
  --v-tabs-height: 46px;
}

.peach-tabs :deep(.v-tab) {
  color: #9A7567;
  font-weight: 500;
  text-transform: none;
  letter-spacing: 0;
  transition: all 0.2s ease;
}

.peach-tabs :deep(.v-tab:hover) {
  color: #E2784A;
  background: #FFF7F1;
}

.peach-tabs :deep(.v-tab--selected) {
  color: #C4623A !important;
  font-weight: 600;
}

.peach-tabs :deep(.v-tab__slider) {
  background: #E2784A !important;
  height: 3px;
  border-radius: 3px 3px 0 0;
}
</style>