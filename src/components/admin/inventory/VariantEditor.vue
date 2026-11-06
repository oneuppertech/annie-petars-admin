<script setup>
const variants = defineModel({ type: Array, default: () => [] })
const props = defineProps({ baseSku: { type: String, default: '' } })

const newRow = (size = '', colour = '') => ({
  size, colour,
  sku: props.baseSku && size ? `${props.baseSku}-${size}` : '',
  price: '', stock_quantity: 0, is_active: true
})

function addSizes(list) {
  const have = new Set(variants.value.map((v) => v.size))
  variants.value = [...variants.value, ...list.filter((s) => !have.has(s)).map((s) => newRow(s))]
}
const add = () => (variants.value = [...variants.value, newRow()])
const remove = (i) => (variants.value = variants.value.filter((_, idx) => idx !== i))
</script>

<template>
  <div>
    <div class="mb-3 flex flex-wrap items-center gap-2">
      <v-btn color="#FFC4A3" size="small" prepend-icon="mdi-plus" @click="add">Add variant</v-btn>
      <v-btn size="small" variant="tonal" @click="addSizes(['S','M','L','XL'])">Add S–XL</v-btn>
      <v-btn size="small" variant="tonal" @click="addSizes(['XS','S','M','L','XL','XXL'])">Add XS–XXL</v-btn>
      <span class="text-xs text-gray-500">Leave price blank to use the product price. Removed variants are deactivated so order history stays intact.</span>
    </div>

    <p v-if="!variants.length" class="py-12 text-center text-gray-500">
      No variants. The product will be treated as always in stock.
    </p>

    <div v-for="(v, i) in variants" :key="v.id || i" class="mb-2 grid grid-cols-12 items-center gap-2">
      <v-text-field variant="outlined" color="primary" v-model="v.size" label="Size" density="compact" hide-details class="col-span-2" />
      <v-text-field variant="outlined" color="primary" v-model="v.colour" label="Colour" density="compact" hide-details class="col-span-2" />
      <v-text-field variant="outlined" color="primary" v-model="v.sku" label="SKU" density="compact" hide-details class="col-span-3" />
      <v-text-field variant="outlined" color="primary" v-model="v.price" label="Price ₦" type="number" min="0" density="compact" hide-details class="col-span-2" />
      <v-text-field variant="outlined" color="primary" v-model.number="v.stock_quantity" label="Stock" type="number" min="0" density="compact" hide-details class="col-span-2" />
      <v-btn icon="mdi-delete" size="small" variant="text" color="error" @click="remove(i)" />
    </div>
  </div>
</template>