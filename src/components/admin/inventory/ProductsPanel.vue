<script setup>
import { ref, watch, computed, onMounted, inject } from 'vue'
import { inventoryApi, errMsg, formatNaira } from '@/services/inventory'
import ProductEditor from './ProductEditor.vue'

const props = defineProps({ collections: { type: Array, default: () => [] } })
const emit = defineEmits(['changed'])
const notify = inject('notify')

const rows = ref([])
const total = ref(0)
const page = ref(1)
const limit = 20
const loading = ref(false)
const q = ref('')
const status = ref('')
const collectionId = ref('')
const selected = ref([])
const editorOpen = ref(false)
const editingId = ref(null)
let timer

const pages = computed(() => Math.max(1, Math.ceil(total.value / limit)))
const allChecked = computed(() => rows.value.length && rows.value.every((r) => selected.value.includes(r.id)))

async function load() {
  loading.value = true
  try {
    const res = await inventoryApi.products({
      page: page.value, limit, q: q.value, status: status.value, collection_id: collectionId.value
    })
    rows.value = res.products
    total.value = res.total
    selected.value = []
  } catch (e) {
    notify(errMsg(e), 'error')
  } finally {
    loading.value = false
  }
}

watch([status, collectionId], () => { page.value = 1; load() })
watch(q, () => { clearTimeout(timer); timer = setTimeout(() => { page.value = 1; load() }, 350) })
watch(page, load)
onMounted(load)

const toggleAll = () => (selected.value = allChecked.value ? [] : rows.value.map((r) => r.id))
const openEditor = (id = null) => { editingId.value = id; editorOpen.value = true }

async function bulk(newStatus) {
  try {
    await inventoryApi.act('set_status', { ids: selected.value, status: newStatus })
    notify(`${selected.value.length} product(s) updated`)
    load()
  } catch (e) {
    notify(errMsg(e), 'error')
  }
}

const statusColor = { active: 'success', draft: 'warning', archived: 'grey' }
</script>

<template>
  <div>
    <div class="mb-4 flex flex-wrap items-center gap-3">
      <v-text-field v-model="q" label="Search name or SKU" prepend-inner-icon="mdi-magnify"
        density="compact" variant="outlined" hide-details clearable class="max-w-xs" />
      <v-select v-model="status" :items="[{title:'All statuses',value:''},{title:'Active',value:'active'},{title:'Draft',value:'draft'},{title:'Archived',value:'archived'}]"
        density="compact" variant="outlined" hide-details class="max-w-[11rem]" />
      <v-select v-model="collectionId"
        :items="[{title:'All collections',value:''},{title:'Uncategorised',value:'none'},...props.collections.map(c=>({title:c.name,value:c.id}))]"
        density="compact" variant="outlined" hide-details class="max-w-[16rem]" />
      <v-spacer />
      <v-menu v-if="selected.length">
        <template #activator="{ props: p }">
          <v-btn v-bind="p" variant="tonal">{{ selected.length }} selected</v-btn>
        </template>
        <v-list>
          <v-list-item title="Publish" @click="bulk('active')" />
          <v-list-item title="Move to draft" @click="bulk('draft')" />
          <v-list-item title="Archive" @click="bulk('archived')" />
        </v-list>
      </v-menu>
      <v-btn color="#FFC4A3" @click="openEditor()">New product</v-btn>
    </div>

    <div class="overflow-x-auto rounded-lg border">
      <table class="w-full text-sm">
        <thead class="bg-gray-50 text-left text-xs uppercase text-gray-500">
          <tr>
            <th class="w-10 p-3"><input type="checkbox" :checked="allChecked" @change="toggleAll" /></th>
            <th class="p-3">Product</th><th class="p-3">Collection</th><th class="p-3">Price</th>
            <th class="p-3">Stock</th><th class="p-3">Status</th>
          </tr>
        </thead>
        <tbody>
          <tr v-if="loading"><td colspan="6" class="p-8 text-center text-gray-500">Loading…</td></tr>
          <tr v-else-if="!rows.length"><td colspan="6" class="p-8 text-center text-gray-500">No products found</td></tr>
          <tr v-for="r in rows" v-else :key="r.id" class="cursor-pointer border-t hover:bg-gray-50" @click="openEditor(r.id)">
            <td class="p-3" @click.stop><input v-model="selected" type="checkbox" :value="r.id" /></td>
            <td class="p-3">
              <div class="flex items-center gap-3">
                <img v-if="r.image" :src="r.image" class="h-12 w-12 rounded object-cover" alt="" />
                <div v-else class="h-12 w-12 rounded bg-gray-100" />
                <div>
                  <p class="font-medium">{{ r.name }}</p>
                  <p class="text-xs text-gray-500">{{ r.sku || 'No SKU' }}</p>
                </div>
              </div>
            </td>
            <td class="p-3">{{ r.collection_name || '—' }}</td>
            <td class="p-3">{{ formatNaira(r.price_kobo) }}</td>
            <td class="p-3">
              <span :class="r.variant_count && r.total_stock <= 0 ? 'font-semibold text-red-600' : ''">
                {{ r.variant_count ? r.total_stock : '—' }}
              </span>
              <span class="text-xs text-gray-500"> / {{ r.variant_count }} variants</span>
            </td>
            <td class="p-3"><v-chip size="small" :color="statusColor[r.status]" label>{{ r.status }}</v-chip></td>
          </tr>
        </tbody>
      </table>
    </div>

    <div class="mt-4 flex items-center justify-between text-sm text-gray-600">
      <span>{{ total }} products</span>
      <v-pagination v-model="page" :length="pages" :total-visible="5" density="comfortable" />
    </div>

    <ProductEditor v-model="editorOpen" :product-id="editingId" :collections="props.collections"
      @saved="() => { load(); emit('changed') }" />
  </div>
</template>

<style scoped>
.filters :deep(.v-field--variant-outlined .v-field__outline) { color: #FFC4A3; }
.filters :deep(.v-field--variant-outlined.v-field--focused .v-field__outline) { color: #E2784A; }
</style>