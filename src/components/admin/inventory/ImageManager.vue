<script setup>
import { ref, inject } from 'vue'
import { inventoryApi, errMsg } from '@/services/inventory'

const images = defineModel({ type: Array, default: () => [] })
const notify = inject('notify')
const uploading = ref(false)
const input = ref(null)

const isVid = (f) => f.type.startsWith('video/')

async function onFiles(e) {
  const files = [...e.target.files]
  e.target.value = ''
  uploading.value = true
  for (const file of files) {
    try {
      const { url } = await inventoryApi.uploadMedia(file)
      images.value = [...images.value, {
        image_url: url,
        alt_text: '',
        media_type: isVid(file) ? 'video' : 'image',
        is_primary: !isVid(file) && !images.value.some((i) => i.is_primary)
      }]
    } catch (err) {
      notify(`${file.name}: ${errMsg(err)}`, 'error')
    }
  }
  uploading.value = false
}

const setPrimary = (i) => {
  if (images.value[i].media_type === 'video') return
  images.value = images.value.map((img, idx) => ({ ...img, is_primary: idx === i }))
}
function move(i, dir) {
  const list = [...images.value]
  const j = i + dir
  if (j < 0 || j >= list.length) return
  ;[list[i], list[j]] = [list[j], list[i]]
  images.value = list
}
function remove(i) {
  const list = images.value.filter((_, idx) => idx !== i)
  if (list.length && !list.some((x) => x.is_primary)) {
    const k = list.findIndex((x) => x.media_type !== 'video')
    if (k >= 0) list[k] = { ...list[k], is_primary: true }
  }
  images.value = list
}
</script>

<template>
  <div>
    <input ref="input" type="file" accept="image/jpeg,image/png,image/webp,image/gif,video/mp4,video/webm,video/quicktime" multiple hidden @change="onFiles" />
    <v-btn :loading="uploading" color="#FFC4A3" prepend-icon="mdi-upload" @click="input.click()">Upload media</v-btn>
    <span class="ml-3 text-xs text-gray-500">Images max 5MB, videos (MP4/WEBM/MOV) max 50MB. The primary image is shown first.</span>

    <p v-if="!images.length" class="py-12 text-center text-gray-500">No media yet</p>
    <div class="mt-4 grid grid-cols-2 gap-4 md:grid-cols-3">
      <div v-for="(img, i) in images" :key="img.id || img.image_url" class="rounded-lg border p-2">
        <div class="relative aspect-square overflow-hidden rounded bg-gray-100">
          <video v-if="img.media_type === 'video'" :src="img.image_url" class="h-full w-full object-cover" controls muted preload="metadata" />
          <img v-else :src="img.image_url" class="h-full w-full object-cover" alt="" />
          <v-chip v-if="img.is_primary" size="x-small" color="primary" class="absolute left-1 top-1">Primary</v-chip>
          <v-chip v-if="img.media_type === 'video'" size="x-small" class="absolute right-1 top-1">Video</v-chip>
        </div>
        <v-text-field v-if="img.media_type !== 'video'" v-model="img.alt_text" label="Alt text" density="compact" variant="underlined" hide-details class="mt-1" />
        <div class="mt-1 flex items-center justify-between">
          <div>
            <v-btn icon="mdi-arrow-left" size="x-small" variant="text" :disabled="i === 0" @click="move(i, -1)" />
            <v-btn icon="mdi-arrow-right" size="x-small" variant="text" :disabled="i === images.length - 1" @click="move(i, 1)" />
          </div>
          <div>
            <v-btn icon="mdi-star" size="x-small" variant="text" :disabled="img.media_type === 'video'" :color="img.is_primary ? 'primary' : undefined" @click="setPrimary(i)" />
            <v-btn icon="mdi-delete" size="x-small" variant="text" color="error" @click="remove(i)" />
          </div>
        </div>
      </div>
    </div>
  </div>
</template>