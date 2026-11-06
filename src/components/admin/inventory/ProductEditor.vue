<script setup>
import { ref, watch, inject } from 'vue'
import { inventoryApi, errMsg, toKobo, toNaira } from '@/services/inventory'
import ImageManager from './ImageManager.vue'
import VariantEditor from './VariantEditor.vue'

const props = defineProps({
  modelValue: Boolean,
  productId: { type: String, default: null },
  collections: { type: Array, default: () => [] }
})
const emit = defineEmits(['update:modelValue', 'saved'])
const notify = inject('notify')

const blank = () => ({
  name: '', slug: '', sku: '', collection_id: null, product_type: 'ready_to_wear', status: 'draft',
  price: 0, compare_at_price: null, short_description: '', description: '', fabric: '', care_instructions: '',
  is_featured: false, is_new_arrival: false, is_customisable: false, allow_backorder: false,
  seo_title: '', seo_description: ''
})

const tab = ref('details')
const form = ref(blank())
const images = ref([]) // now holds images and videos (media_type)
const variants = ref([])
const loading = ref(false)
const saving = ref(false)

watch(() => props.modelValue, async (open) => {
  if (!open) return
  tab.value = 'details'
  form.value = blank(); images.value = []; variants.value = []
  if (!props.productId) return
  loading.value = true
  try {
    const { product: p } = await inventoryApi.product(props.productId)
    form.value = {
      ...blank(), ...Object.fromEntries(Object.entries(p).map(([k, v]) => [k, v ?? blank()[k] ?? null])),
      price: toNaira(p.price_kobo),
      compare_at_price: p.compare_at_price_kobo != null ? toNaira(p.compare_at_price_kobo) : null
    }
    images.value = p.product_images
    variants.value = p.product_variants
      .filter((v) => v.is_active)
      .map((v) => ({ ...v, price: v.price_kobo != null ? toNaira(v.price_kobo) : '' }))
  } catch (e) {
    notify(errMsg(e), 'error'); close()
  } finally {
    loading.value = false
  }
})

const close = () => emit('update:modelValue', false)

async function save() {
  if (!form.value.name.trim()) { tab.value = 'details'; return notify('Product name is required', 'error') }
  const f = form.value
  if (f.compare_at_price && Number(f.compare_at_price) <= Number(f.price)) {
    tab.value = 'details'
    return notify('Original price must be higher than the selling price', 'error')
  }
  saving.value = true
  try {
    await inventoryApi.act('save_product', {
      id: props.productId || undefined,
      product: {
        ...f,
        price_kobo: toKobo(f.price),
        compare_at_price_kobo: f.compare_at_price ? toKobo(f.compare_at_price) : null
      },
      images: images.value,
      variants: variants.value.map((v) => ({
        id: v.id, sku: v.sku, size: v.size, colour: v.colour,
        price_kobo: v.price === '' || v.price == null ? null : toKobo(v.price),
        stock_quantity: Number(v.stock_quantity) || 0,
        is_active: v.is_active !== false
      }))
    })
    notify('Product saved')
    emit('saved'); close()
  } catch (e) {
    notify(errMsg(e), 'error')
  } finally {
    saving.value = false
  }
}

async function remove() {
  if (!confirm('Delete this product permanently? This cannot be undone.')) return
  try {
    await inventoryApi.act('delete_product', { id: props.productId })
    notify('Product deleted')
    emit('saved'); close()
  } catch (e) {
    notify(errMsg(e), 'error')
  }
}
</script>

<template>
  <v-dialog :model-value="modelValue" max-width="900" scrollable persistent @update:model-value="close">
    <v-card>
      <v-card-title class="flex items-center justify-between">
        {{ productId ? 'Edit product' : 'New product' }}
        <v-btn icon="mdi-close" variant="text" @click="close" />
      </v-card-title>
      <v-tabs v-model="tab" class="border-b">
        <v-tab value="details">Details</v-tab>
        <v-tab value="images">Media ({{ images.length }})</v-tab>
        <v-tab value="variants">Variants & stock ({{ variants.length }})</v-tab>
      </v-tabs>

      <v-card-text style="min-height: 420px">
        <div v-if="loading" class="py-16 text-center text-gray-500">Loading…</div>

        <div v-else-if="tab === 'details'" class="grid gap-4 md:grid-cols-2">
          <v-text-field variant="outlined" color="primary" v-model="form.name" label="Name *" class="md:col-span-2" hide-details="auto" />
          <v-text-field variant="outlined" color="primary" v-model="form.slug" label="Slug (auto from name if empty)" hide-details />
          <v-text-field variant="outlined" color="primary" v-model="form.sku" label="SKU" hide-details />
          <v-select variant="outlined" color="primary" v-model="form.collection_id" label="Collection" clearable hide-details
            :items="collections.map((c) => ({ title: c.name, value: c.id }))" />
          <v-combobox variant="outlined" color="primary" v-model="form.product_type" label="Product type" hide-details
            :items="['ready_to_wear','occasion_wear','bridal','aso_ebi','made_to_measure','girl_child']" />
          <v-text-field variant="outlined" color="primary" v-model.number="form.price" label="Selling / promo price (₦)" type="number" min="0" hide-details />
          <v-text-field variant="outlined" color="primary" v-model.number="form.compare_at_price" label="Original price (₦), set only for a discount" type="number" min="0" hide-details />
          <v-select variant="outlined" color="primary" v-model="form.status" label="Status" hide-details
            :items="[{title:'Draft',value:'draft'},{title:'Active (visible in shop)',value:'active'},{title:'Archived',value:'archived'}]" />
          <v-text-field variant="outlined" color="primary" v-model="form.fabric" label="Fabric" hide-details />
          <v-textarea variant="outlined" color="primary" v-model="form.short_description" label="Short description" rows="2" auto-grow class="md:col-span-2" hide-details />
          <v-textarea variant="outlined" color="primary" v-model="form.description" label="Description" rows="4" auto-grow class="md:col-span-2" hide-details />
          <v-textarea variant="outlined" color="primary" v-model="form.care_instructions" label="Care instructions" rows="2" auto-grow class="md:col-span-2" hide-details />
          <div class="flex flex-wrap gap-x-6 md:col-span-2">
            <v-switch v-model="form.is_featured" label="Featured" color="primary" hide-details density="compact" />
            <v-switch v-model="form.is_new_arrival" label="New arrival" color="primary" hide-details density="compact" />
            <v-switch v-model="form.is_customisable" label="Customisable" color="primary" hide-details density="compact" />
            <v-switch v-model="form.allow_backorder" label="Allow backorder" color="primary" hide-details density="compact" />
          </div>
          <v-text-field variant="outlined" color="primary" v-model="form.seo_title" label="SEO title" hide-details />
          <v-text-field variant="outlined" color="primary" v-model="form.seo_description" label="SEO description" hide-details />
        </div>

        <ImageManager v-else-if="tab === 'images'" v-model="images" />
        <VariantEditor v-else v-model="variants" :base-sku="form.sku" />
      </v-card-text>

      <v-card-actions class="border-t px-6">
        <v-btn v-if="productId" color="error" variant="text" @click="remove">Delete</v-btn>
        <v-spacer />
        <v-btn variant="text" @click="close">Cancel</v-btn>
        <v-btn color="#FFC4A3" variant="flat" :loading="saving" @click="save">Save product</v-btn>
      </v-card-actions>
    </v-card>
  </v-dialog>
</template>