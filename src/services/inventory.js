import ApiService from '@/services/api'
import { supabase } from '@/services/supabase'
const BASE = '/admin-inventory'
const un = (r) => r?.data ?? r
const qs = (o) =>
  new URLSearchParams(Object.entries(o).filter(([, v]) => v !== '' && v != null)).toString()

export const inventoryApi = {
  collections: () => ApiService.get(`${BASE}?resource=collections`),
  products: (p) => ApiService.get(`${BASE}?${qs({ resource: 'products', ...p })}`),
  product: (id) => ApiService.get(`${BASE}?${qs({ resource: 'product', id })}`),
  lowStock: (threshold) => ApiService.get(`${BASE}?${qs({ resource: 'low_stock', threshold })}`),
  act: (action, payload = {}) => ApiService.post(BASE, { action, ...payload }),
  uploadImage: (file) => {
    const fd = new FormData()
    fd.append('file', file)
    return ApiService.upload(BASE, fd)
  },
  uploadMedia: async (file) => {
  if (file.type.startsWith('image/')) {
    return inventoryApi.uploadImage(file)
  }

  if (!file.type.startsWith('video/')) {
    throw new Error('Unsupported media format')
  }

  const signed = await inventoryApi.act('sign_upload', {
    content_type: file.type
  })

  const { data, error } = await supabase.storage
    .from('product-images')
    .uploadToSignedUrl(
      signed.path,
      signed.token,
      file,
      {
        contentType: file.type,
        upsert: false
      }
    )

  if (error) {
    console.error('Video upload failed:', error)
    throw new Error(error.message)
  }

  return {
    url: signed.url,
    path: data.path,
    media_type: 'video'
  }
}
}

export const errMsg = (e) => e?.response?.data?.error || e?.message || 'Something went wrong'
export const toKobo = (n) => Math.round(Number(n || 0) * 100)
export const toNaira = (k) => (k || 0) / 100
export const formatNaira = (kobo) =>
  new Intl.NumberFormat('en-NG', { style: 'currency', currency: 'NGN' }).format((kobo || 0) / 100)