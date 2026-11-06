import 'dotenv/config'
import { createClient } from '@supabase/supabase-js'
import { readFile } from 'node:fs/promises'
import path from 'node:path'

const url = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL
const key = process.env.SUPABASE_SERVICE_ROLE_KEY
if (!url || !key) throw new Error('Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in .env')

const supabase = createClient(url, key, { auth: { autoRefreshToken: false, persistSession: false } })
const BUCKET = 'product-images'
const ASSETS_DIR = path.resolve('public/assets')
const TYPES = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.gif': 'image/gif' }

const cache = new Map() // file -> public url, so shared files upload once
async function toStorage(rel) {
  const file = path.basename(rel)
  if (cache.has(file)) return cache.get(file)
  const contentType = TYPES[path.extname(file).toLowerCase()]
  if (!contentType) throw new Error(`Unsupported type: ${file}`)
  const dest = `catalog/seed/${file}`
  const { error } = await supabase.storage.from(BUCKET)
    .upload(dest, await readFile(path.join(ASSETS_DIR, file)), { contentType, upsert: true, cacheControl: '3600' })
  if (error) throw new Error(error.message)
  const publicUrl = supabase.storage.from(BUCKET).getPublicUrl(dest).data.publicUrl
  cache.set(file, publicUrl)
  return publicUrl
}

for (const [table, label] of [['product_images', 'product'], ['collection_media', 'collection media']]) {
  const { data: rows, error } = await supabase.from(table).select('id,image_url').like('image_url', '/assets/%')
  if (error) { console.error(`${label}: ${error.message}`); continue }
  for (const r of rows) {
    try {
      const publicUrl = await toStorage(r.image_url)
      const { error: e } = await supabase.from(table).update({ image_url: publicUrl }).eq('id', r.id)
      if (e) throw new Error(e.message)
      console.log(`✓ ${label}: ${r.image_url} → ${publicUrl}`)
    } catch (e) { console.error(`✗ ${label} ${r.image_url}: ${e.message}`) }
  }
}

// collections.image_url too (covers anything the collection script didn't reach)
const { data: cols } = await supabase.from('collections').select('id,slug,image_url').like('image_url', '/assets/%')
for (const c of cols || []) {
  try {
    const publicUrl = await toStorage(c.image_url)
    await supabase.from('collections').update({ image_url: publicUrl }).eq('id', c.id)
    console.log(`✓ collection ${c.slug}`)
  } catch (e) { console.error(`✗ collection ${c.slug}: ${e.message}`) }
}