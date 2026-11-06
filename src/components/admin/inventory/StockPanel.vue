<script setup>
import { ref, onMounted, inject } from 'vue'
import { inventoryApi, errMsg } from '@/services/inventory'

const notify = inject('notify')
const threshold = ref(5)
const rows = ref([])
const loading = ref(false)

async function load() {
  loading.value = true
  try {
    rows.value = (await inventoryApi.lowStock(threshold.value)).variants
  } catch (e) {
    notify(errMsg(e), 'error')
  } finally {
    loading.value = false
  }
}
onMounted(load)

async function adjust(row, payload) {
  try {
    const res = await inventoryApi.act('adjust_stock', { variant_id: row.id, ...payload })
    row.stock_quantity = res.stock_quantity
  } catch (e) {
    notify(errMsg(e), 'error')
    load()
  }
}
const setStock = (row, v) => {
  const n = Number(v)
  if (Number.isInteger(n) && n >= 0 && n !== row.stock_quantity) adjust(row, { set: n })
}
</script>

<template>
  <div>
    <div class="mb-4 flex items-center gap-3">
      <v-text-field v-model.number="threshold" type="number" min="0" label="Show variants with stock at or below"
        density="compact" variant="outlined" hide-details class="max-w-xs" @keyup.enter="load" />
      <v-btn :loading="loading" @click="load">Refresh</v-btn>
    </div>

    <div class="overflow-x-auto rounded-lg border">
      <table class="w-full text-sm">
        <thead class="bg-gray-50 text-left text-xs uppercase text-gray-500">
          <tr><th class="p-3">Product</th><th class="p-3">Variant</th><th class="p-3">SKU</th><th class="p-3">Stock</th></tr>
        </thead>
        <tbody>
          <tr v-if="!rows.length"><td colspan="4" class="p-8 text-center text-gray-500">{{ loading ? 'Loading…' : 'Nothing is running low' }}</td></tr>
          <tr v-for="r in rows" v-else :key="r.id" class="border-t">
            <td class="p-3">
              {{ r.products.name }}
              <v-chip v-if="r.products.status === 'draft'" size="x-small" class="ml-1">draft</v-chip>
            </td>
            <td class="p-3">{{ [r.size, r.colour].filter(Boolean).join(' / ') || '—' }}</td>
            <td class="p-3 text-gray-500">{{ r.sku || '—' }}</td>
            <td class="p-3">
              <div class="flex items-center gap-1">
                <v-btn icon="mdi-minus" size="x-small" variant="tonal" :disabled="r.stock_quantity <= 0" @click="adjust(r, { delta: -1 })" />
                <input :value="r.stock_quantity" type="number" min="0"
                  class="w-16 rounded border px-2 py-1 text-center" :class="r.stock_quantity <= 0 ? 'border-red-400 text-red-600' : ''"
                  @change="setStock(r, $event.target.value)" />
                <v-btn icon="mdi-plus" size="x-small" variant="tonal" @click="adjust(r, { delta: 1 })" />
              </div>
            </td>
          </tr>
        </tbody>
      </table>
    </div>
  </div>
</template>