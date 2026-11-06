<script setup>
import { ref, inject } from 'vue'
import { inventoryApi, errMsg } from '@/services/inventory'
import ImageManager from './ImageManager.vue'

const props = defineProps({ collections: { type: Array, default: () => [] } })
const emit = defineEmits(['changed'])
const notify = inject('notify')

const dialog = ref(false)
const saving = ref(false)
const media = ref([])
const blank = () => ({ name: '', slug: '', tagline: '', description: '', image_url: '', is_active: true, seo_title: '', seo_description: '' })
const form = ref(blank())

function openForm(c = null) {
  form.value = c ? { ...blank(), ...Object.fromEntries(Object.entries(c).map(([k, v]) => [k, v ?? ''])) } : blank()
  media.value = c?.collection_media?.length
    ? [...c.collection_media].sort((a, b) => a.sort_order - b.sort_order)
    : c?.image_url
      ? [{ image_url: c.image_url, alt_text: '', media_type: 'image', is_primary: true }] // legacy cover image
      : []
  dialog.value = true
}

async function saveForm() {
  const cover = media.value.find((m) => m.is_primary && m.media_type !== 'video') || media.value.find((m) => m.media_type !== 'video')
  await save({ ...form.value, image_url: cover?.image_url || '', media: media.value })
}

async function save(payload = form.value) {
  saving.value = true
  try {
    await inventoryApi.act('save_collection', {
      ...payload,
      sort_order: payload.sort_order ?? props.collections.length + 1
    })
    notify('Collection saved')
    dialog.value = false
    emit('changed')
  } catch (e) {
    notify(errMsg(e), 'error')
  } finally {
    saving.value = false
  }
}

const toggleActive = (c) => save({ ...c, is_active: !c.is_active })

async function move(i, dir) {
  const ids = props.collections.map((c) => c.id)
  const j = i + dir
  if (j < 0 || j >= ids.length) return
  ;[ids[i], ids[j]] = [ids[j], ids[i]]
  try {
    await inventoryApi.act('reorder_collections', { order: ids })
    emit('changed')
  } catch (e) {
    notify(errMsg(e), 'error')
  }
}

async function remove(c, force = false) {
  if (!force && !confirm(`Delete "${c.name}"?`)) return
  try {
    await inventoryApi.act('delete_collection', { id: c.id, force })
    notify('Collection deleted')
    emit('changed')
  } catch (e) {
    if (e?.response?.status === 409 && confirm(e.response.data.error)) return remove(c, true)
    if (e?.response?.status !== 409) notify(errMsg(e), 'error')
  }
}
</script>

<template>
  <div>
    <div class="mb-4 flex justify-end">
      <v-btn color="primary" @click="openForm()">New collection</v-btn>
    </div>

    <div class="divide-y rounded-lg border">
      <p v-if="!collections.length" class="p-8 text-center text-gray-500">No collections yet</p>
      <div v-for="(c, i) in collections" :key="c.id" class="flex items-center gap-3 p-3">
        <div class="flex flex-col">
          <v-btn icon="mdi-chevron-up" size="x-small" variant="text" :disabled="i === 0" @click="move(i, -1)" />
          <v-btn icon="mdi-chevron-down" size="x-small" variant="text" :disabled="i === collections.length - 1" @click="move(i, 1)" />
        </div>
        <img v-if="c.image_url" :src="c.image_url" class="h-14 w-14 rounded object-cover" alt="" />
        <div v-else class="h-14 w-14 rounded bg-gray-100" />
        <div class="min-w-0 flex-1">
          <p class="font-medium">{{ c.name }}</p>
          <p class="truncate text-xs text-gray-500">
            {{ c.tagline || c.slug }} · {{ c.product_count }} products · {{ c.collection_media?.length || 0 }} media
          </p>
        </div>
        <v-switch :model-value="c.is_active" color="primary" hide-details density="compact" @update:model-value="toggleActive(c)" />
        <v-btn icon="mdi-pencil" size="small" variant="text" @click="openForm(c)" />
        <v-btn icon="mdi-delete" size="small" variant="text" color="error" @click="remove(c)" />
      </div>
    </div>

    <v-dialog v-model="dialog" max-width="760" scrollable>
      <v-card class="pa-4" :title="form.id ? 'Edit collection' : 'New collection'">
        <v-card-text class="grid gap-4 mt-2">
          <v-text-field variant="outlined" class="mt-4" color="primary" v-model="form.name" label="Name *" hide-details />
          <v-text-field variant="outlined" color="primary" v-model="form.slug" label="Slug (auto from name if empty)" hide-details />
          <v-text-field variant="outlined" color="primary" v-model="form.tagline" label="Tagline" hide-details />
          <v-textarea variant="outlined" color="primary" v-model="form.description" label="Description" rows="3" auto-grow hide-details />
          <ImageManager v-model="media" />
          <v-switch v-model="form.is_active" label="Visible in shop" color="primary" hide-details density="compact" />
          <v-text-field variant="outlined" color="primary" v-model="form.seo_title" label="SEO title" hide-details />
          <v-text-field variant="outlined" color="primary" v-model="form.seo_description" label="SEO description" hide-details />
        </v-card-text>
        <v-card-actions>
          <v-spacer />
          <v-btn variant="text" @click="dialog = false">Cancel</v-btn>
          <v-btn color="primary" :loading="saving" @click="saveForm">Save</v-btn>
        </v-card-actions>
      </v-card>
    </v-dialog>
  </div>
</template>