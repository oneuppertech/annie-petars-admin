import { handle, reply, readJson, requireMethod, text, HttpError } from '../_shared/http.ts'
import { requireRole } from '../_shared/supabaseAdmin.ts'

// deno-lint-ignore no-explicit-any
type DB = any
type Obj = Record<string, unknown>

const READ = ['owner', 'admin', 'catalog_manager', 'order_manager']
const WRITE = ['owner', 'admin', 'catalog_manager']
const BUCKET = 'product-images'
const STATUSES = ['draft', 'active', 'archived']
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const IMG_TYPES: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'image/gif': 'gif'
}

/* ---------- helpers ---------- */
const uid = (v: unknown) => {
  if (typeof v !== 'string' || !UUID.test(v)) throw new HttpError(400, 'Invalid id')
  return v
}
const int = (v: unknown, min = 0, max = 1_000_000_000_000, label = 'Value') => {
  const n = Number(v)
  if (!Number.isInteger(n) || n < min || n > max) throw new HttpError(400, `${label} is invalid`)
  return n
}
const optInt = (v: unknown, label?: string) =>
  v === null || v === undefined || v === '' ? null : int(v, 0, undefined, label)
const slugify = (s: string) =>
  s
    .toLowerCase()
    .replace(/['’]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 120)
const arr = (v: unknown, max: number): Obj[] => (Array.isArray(v) ? (v.slice(0, max) as Obj[]) : [])

function check(error: { code?: string; message?: string } | null) {
  if (!error) return
  if (error.code === '23505') throw new HttpError(409, 'That slug or SKU is already in use')
  if (error.code === 'P0002') throw new HttpError(404, 'Not found')
  if (error.message?.includes('stock_quantity'))
    throw new HttpError(400, 'Stock cannot go below zero')
  if (['23514', '22P02', '23503'].includes(error.code || ''))
    throw new HttpError(400, error.message || 'Invalid data')
  console.error(error)
  throw new HttpError(500, 'Database error')
}

const audit = (
  db: DB,
  userId: string,
  action: string,
  type: string,
  entityId: string | null,
  metadata: Obj = {}
) =>
  db
    .from('audit_logs')
    .insert({ actor_user_id: userId, action, entity_type: type, entity_id: entityId, metadata })
    .then(() => {}, console.error)

const storagePath = (url: string) => {
  const m = url.match(new RegExp(`/object/public/${BUCKET}/(.+)$`))
  return m ? decodeURIComponent(m[1]) : null
}
async function removeFiles(db: DB, urls: string[]) {
  const paths = urls.map(storagePath).filter(Boolean) as string[]
  if (paths.length) await db.storage.from(BUCKET).remove(paths).catch(console.error)
}

/* ---------- reads ---------- */
async function listCollections(db: DB) {
  const { data, error } = await db
    .from('collections')
    .select('*, products(count)')
    .order('sort_order')
    .order('name')
  check(error)
  return {
    collections: (data || []).map(
      ({ products, ...c }: Obj & { products?: { count: number }[] }) => ({
        ...c,
        product_count: products?.[0]?.count ?? 0
      })
    )
  }
}

async function listProducts(db: DB, sp: URLSearchParams) {
  const page = Math.max(1, Number(sp.get('page')) || 1)
  const size = Math.min(100, Math.max(1, Number(sp.get('limit')) || 20))
  let q = db.from('products').select(
    `id,name,slug,sku,status,price_kobo,compare_at_price_kobo,is_featured,is_new_arrival,collection_id,updated_at,
     collections(name),product_images(image_url,is_primary,sort_order),product_variants(stock_quantity,is_active)`,
    { count: 'exact' }
  )
  const status = sp.get('status')
  if (status) {
    if (!STATUSES.includes(status)) throw new HttpError(400, 'Invalid status')
    q = q.eq('status', status)
  }
  const col = sp.get('collection_id')
  if (col === 'none') q = q.is('collection_id', null)
  else if (col) q = q.eq('collection_id', uid(col))
  const s = (sp.get('q') || '')
    .replace(/[%,()*\\]/g, ' ')
    .trim()
    .slice(0, 80)
  if (s) q = q.or(`name.ilike.%${s}%,sku.ilike.%${s}%`)

  const { data, count, error } = await q
    .order('updated_at', { ascending: false })
    .range((page - 1) * size, page * size - 1)
  check(error)

  const products = (data || []).map(
    (
      p: Obj & { collections?: { name: string }; product_images: Obj[]; product_variants: Obj[] }
    ) => {
      const { collections, product_images, product_variants, ...rest } = p
      const imgs = [...product_images].sort(
        (a, b) =>
          Number(b.is_primary) - Number(a.is_primary) || Number(a.sort_order) - Number(b.sort_order)
      )
      const vs = product_variants.filter((v) => v.is_active)
      return {
        ...rest,
        collection_name: collections?.name ?? null,
        image: (imgs[0]?.image_url as string) ?? null,
        variant_count: vs.length,
        total_stock: vs.reduce((n, v) => n + Number(v.stock_quantity), 0)
      }
    }
  )
  return { total: count ?? 0, page, limit: size, products }
}

async function getProduct(db: DB, id: string) {
  const { data, error } = await db
    .from('products')
    .select('*, product_images(*), product_variants(*)')
    .eq('id', id)
    .maybeSingle()
  check(error)
  if (!data) throw new HttpError(404, 'Product not found')
  data.product_images.sort((a: Obj, b: Obj) => Number(a.sort_order) - Number(b.sort_order))
  data.product_variants.sort((a: Obj, b: Obj) =>
    String(a.size || '').localeCompare(String(b.size || ''))
  )
  return data
}

async function lowStock(db: DB, sp: URLSearchParams) {
  const threshold = Math.min(1000, Math.max(0, Number(sp.get('threshold') ?? 5) || 0))
  const { data, error } = await db
    .from('product_variants')
    .select('id,sku,size,colour,stock_quantity,products!inner(id,name,status,allow_backorder)')
    .eq('is_active', true)
    .neq('products.status', 'archived')
    .lte('stock_quantity', threshold)
    .order('stock_quantity')
    .limit(200)
  check(error)
  return { threshold, variants: data || [] }
}

/* ---------- collections ---------- */
async function saveCollection(db: DB, userId: string, b: Obj) {
  const name = text(b.name, 120)
  if (!name) throw new HttpError(400, 'Collection name is required')
  const row = {
    name,
    slug: slugify(text(b.slug, 120) || name),
    description: text(b.description, 1000) || null,
    tagline: text(b.tagline, 200) || null,
    image_url: text(b.image_url, 1000) || null,
    sort_order: int(b.sort_order ?? 0, 0, 100000, 'Sort order'),
    is_active: b.is_active !== false,
    seo_title: text(b.seo_title, 120) || null,
    seo_description: text(b.seo_description, 300) || null
  }
  if (!row.slug) throw new HttpError(400, 'A valid slug is required')
  if (b.id) {
    const id = uid(b.id)
    const { data, error } = await db
      .from('collections')
      .update(row)
      .eq('id', id)
      .select()
      .maybeSingle()
    check(error)
    if (!data) throw new HttpError(404, 'Collection not found')
    await audit(db, userId, 'collection.update', 'collection', id)
    return { collection: data }
  }
  const { data, error } = await db.from('collections').insert(row).select().single()
  check(error)
  await audit(db, userId, 'collection.create', 'collection', data.id)
  return { collection: data }
}

async function deleteCollection(db: DB, userId: string, b: Obj) {
  const id = uid(b.id)
  const { count } = await db
    .from('products')
    .select('id', { count: 'exact', head: true })
    .eq('collection_id', id)
  if ((count || 0) > 0 && b.force !== true)
    throw new HttpError(
      409,
      `This collection has ${count} product(s). They will become uncategorised if you continue.`,
      { product_count: count }
    )
  const { data: col } = await db.from('collections').select('image_url').eq('id', id).maybeSingle()
  const { error } = await db.from('collections').delete().eq('id', id)
  check(error)
  if (col?.image_url) await removeFiles(db, [col.image_url])
  await audit(db, userId, 'collection.delete', 'collection', id, { affected_products: count || 0 })
  return { ok: true }
}

async function reorderCollections(db: DB, userId: string, b: Obj) {
  const ids = (Array.isArray(b.order) ? b.order : []).slice(0, 200).map(uid)
  const results = await Promise.all(
    ids.map((id, i) =>
      db
        .from('collections')
        .update({ sort_order: i + 1 })
        .eq('id', id)
    )
  )
  results.forEach((r) => check(r.error))
  await audit(db, userId, 'collection.reorder', 'collection', null)
  return { ok: true }
}

/* ---------- products ---------- */
const VIDEO_TYPES: Record<string, string> = {
  'video/mp4': 'mp4',
  'video/webm': 'webm',
  'video/quicktime': 'mov'
}

// Videos upload straight to storage via a signed URL (avoids buffering big files in the function)

async function signUpload(db: DB, b: Obj) {
  const ext = VIDEO_TYPES[String(b.content_type)]

  if (!ext) {
    throw new HttpError(400, 'Only MP4, WEBM or MOV videos are allowed')
  }

  const path = `catalog/${crypto.randomUUID()}.${ext}`

  const { data, error } = await db.storage
    .from(BUCKET)
    .createSignedUploadUrl(path)

  if (error) {
    console.error('Signed upload creation failed:', error)
    throw new HttpError(500, 'Could not start video upload')
  }

  return {
    path: data.path,
    token: data.token,
    url: db.storage.from(BUCKET).getPublicUrl(path).data.publicUrl
  }
}


async function syncImages(db: DB, productId: string, input: unknown) {
  const { data: existing, error } = await db
    .from('product_images')
    .select('id,image_url')
    .eq('product_id', productId)
  check(error)
  const existIds = new Set<string>((existing || []).map((i: Obj) => i.id as string))
  const raw = arr(input, 20).filter((i) => text(i.image_url, 1000))
  const primaryIdx = Math.max(
    0,
    raw.findIndex((i) => i.is_primary === true)
  )
  const rows = raw.map((i, idx) => ({
    ...(typeof i.id === 'string' && existIds.has(i.id) ? { id: i.id } : {}),
    product_id: productId,
    image_url: text(i.image_url, 1000),
    alt_text: text(i.alt_text, 200) || null,
    sort_order: idx,
    is_primary: idx === primaryIdx
  }))
  const keep = rows.filter((r) => 'id' in r).map((r) => (r as Obj).id as string)
  let del = db.from('product_images').delete().eq('product_id', productId)
  if (keep.length) del = del.not('id', 'in', `(${keep.join(',')})`)
  check((await del).error)
  const upd = rows.filter((r) => 'id' in r)
  const ins = rows.filter((r) => !('id' in r))
  if (upd.length) check((await db.from('product_images').upsert(upd)).error)
  if (ins.length) check((await db.from('product_images').insert(ins)).error)
  const kept = new Set(rows.map((r) => r.image_url))
  await removeFiles(
    db,
    (existing || []).map((i: Obj) => i.image_url as string).filter((u: string) => !kept.has(u))
  )
}

async function syncMedia(db: DB, table: string, fk: string, ownerId: string, input: unknown) {
  const { data: existing, error } = await db.from(table).select('id,image_url').eq(fk, ownerId)
  check(error)
  const existIds = new Set<string>((existing || []).map((i: Obj) => i.id as string))
  const raw = arr(input, 30).filter((i) => text(i.image_url, 1000))
  const isImg = (i: Obj) => i.media_type !== 'video'
  const p = raw.findIndex((i) => i.is_primary === true && isImg(i))
  const primaryIdx = p >= 0 ? p : Math.max(0, raw.findIndex(isImg))
  const rows = raw.map((i, idx) => ({
    ...(typeof i.id === 'string' && existIds.has(i.id) ? { id: i.id } : {}),
    [fk]: ownerId,
    image_url: text(i.image_url, 1000),
    alt_text: text(i.alt_text, 200) || null,
    media_type: isImg(i) ? 'image' : 'video',
    sort_order: idx,
    is_primary: idx === primaryIdx
  }))
  const keep = rows.filter((r) => 'id' in r).map((r) => (r as Obj).id as string)
  let del = db.from(table).delete().eq(fk, ownerId)
  if (keep.length) del = del.not('id', 'in', `(${keep.join(',')})`)
  check((await del).error)
  const upd = rows.filter((r) => 'id' in r)
  const ins = rows.filter((r) => !('id' in r))
  if (upd.length) check((await db.from(table).upsert(upd)).error)
  if (ins.length) check((await db.from(table).insert(ins)).error)
  const kept = new Set(rows.map((r) => r.image_url))
  await removeFiles(
    db,
    (existing || []).map((i: Obj) => i.image_url as string).filter((u: string) => !kept.has(u))
  )
}

async function syncVariants(db: DB, productId: string, input: unknown) {
  const { data: existing, error } = await db
    .from('product_variants')
    .select('id')
    .eq('product_id', productId)
  check(error)
  const existIds = new Set<string>((existing || []).map((v: Obj) => v.id as string))
  const rows = arr(input, 100).map((v) => ({
    ...(typeof v.id === 'string' && existIds.has(v.id) ? { id: v.id } : {}),
    product_id: productId,
    sku: text(v.sku, 80) || null,
    size: text(v.size, 40) || null,
    colour: text(v.colour, 40) || null,
    price_kobo: optInt(v.price_kobo, 'Variant price'),
    stock_quantity: int(v.stock_quantity ?? 0, 0, 1_000_000, 'Stock'),
    is_active: v.is_active !== false
  }))
  const keep = new Set(rows.filter((r) => 'id' in r).map((r) => (r as Obj).id as string))
  // Removed variants are deactivated, not deleted, so order history stays intact
  const removed = [...existIds].filter((id) => !keep.has(id))
  if (removed.length)
    check((await db.from('product_variants').update({ is_active: false }).in('id', removed)).error)
  const upd = rows.filter((r) => 'id' in r)
  const ins = rows.filter((r) => !('id' in r))
  if (upd.length) check((await db.from('product_variants').upsert(upd)).error)
  if (ins.length) check((await db.from('product_variants').insert(ins)).error)
}

async function saveProduct(db: DB, userId: string, b: Obj) {
  const p = (b.product ?? {}) as Obj
  const name = text(p.name, 200)
  if (!name) throw new HttpError(400, 'Product name is required')
  const status = String(p.status || 'draft')
  if (!STATUSES.includes(status)) throw new HttpError(400, 'Invalid status')

  const row: Obj = {
    collection_id: p.collection_id ? uid(p.collection_id) : null,
    name,
    slug: slugify(text(p.slug, 200) || name),
    sku: text(p.sku, 80) || null,
    short_description: text(p.short_description, 500) || null,
    description: text(p.description, 5000) || null,
    fabric: text(p.fabric, 200) || null,
    care_instructions: text(p.care_instructions, 1000) || null,
    product_type: text(p.product_type, 50) || 'ready_to_wear',
    status,
    price_kobo: int(p.price_kobo, 0, undefined, 'Price'),
    compare_at_price_kobo: optInt(p.compare_at_price_kobo, 'Compare-at price'),
    is_customisable: p.is_customisable === true,
    is_featured: p.is_featured === true,
    is_new_arrival: p.is_new_arrival === true,
    allow_backorder: p.allow_backorder === true,
    seo_title: text(p.seo_title, 120) || null,
    seo_description: text(p.seo_description, 300) || null
  }
  if (!row.slug) throw new HttpError(400, 'A valid slug is required')
  if (
    row.compare_at_price_kobo != null &&
    (row.compare_at_price_kobo as number) <= (row.price_kobo as number)
  )
    throw new HttpError(400, 'Original price must be higher than the selling price')

  const now = new Date().toISOString()
  let productId: string | null = b.id ? uid(b.id) : null
  if (productId) {
    const { data: ex, error } = await db
      .from('products')
      .select('published_at')
      .eq('id', productId)
      .maybeSingle()
    check(error)
    if (!ex) throw new HttpError(404, 'Product not found')
    if (status === 'active') row.published_at = ex.published_at ?? now
    check((await db.from('products').update(row).eq('id', productId)).error)
  } else {
    if (status === 'active') row.published_at = now
    const { data, error } = await db.from('products').insert(row).select('id').single()
    check(error)
    productId = data.id as string
  }

  if (Array.isArray(b.images))
    await syncMedia(db, 'product_images', 'product_id', productId, b.images)
  if (Array.isArray(b.variants)) await syncVariants(db, productId, b.variants)
  await audit(db, userId, b.id ? 'product.update' : 'product.create', 'product', productId, {
    name,
    status
  })
  return { product: await getProduct(db, productId) }
}

async function setStatus(db: DB, userId: string, b: Obj) {
  const ids = (Array.isArray(b.ids) ? b.ids : []).slice(0, 100).map(uid)
  const status = String(b.status)
  if (!ids.length) throw new HttpError(400, 'No products selected')
  if (!STATUSES.includes(status)) throw new HttpError(400, 'Invalid status')
  check((await db.from('products').update({ status }).in('id', ids)).error)
  if (status === 'active')
    check(
      (
        await db
          .from('products')
          .update({ published_at: new Date().toISOString() })
          .in('id', ids)
          .is('published_at', null)
      ).error
    )
  await audit(db, userId, 'product.status', 'product', null, { ids, status })
  return { ok: true, updated: ids.length }
}

async function deleteProduct(db: DB, userId: string, b: Obj) {
  const id = uid(b.id)
  const { count } = await db
    .from('order_items')
    .select('id', { count: 'exact', head: true })
    .eq('product_id', id)
  if ((count || 0) > 0)
    throw new HttpError(409, 'This product appears in past orders. Archive it instead of deleting.')
  const { data: imgs } = await db.from('product_images').select('image_url').eq('product_id', id)
  check((await db.from('products').delete().eq('id', id)).error)
  await removeFiles(
    db,
    (imgs || []).map((i: Obj) => i.image_url as string)
  )
  await audit(db, userId, 'product.delete', 'product', id)
  return { ok: true }
}

/* ---------- stock ---------- */
async function adjustStock(db: DB, userId: string, b: Obj) {
  const variant = uid(b.variant_id)
  const hasSet = b.set !== undefined && b.set !== null
  const { data, error } = await db.rpc('adjust_variant_stock', {
    p_variant: variant,
    p_delta: hasSet ? null : int(b.delta, -1_000_000, 1_000_000, 'Change'),
    p_set: hasSet ? int(b.set, 0, 1_000_000, 'Stock') : null
  })
  check(error)
  await audit(db, userId, 'stock.adjust', 'variant', variant, {
    delta: b.delta ?? null,
    set: b.set ?? null,
    result: data
  })
  return { variant_id: variant, stock_quantity: data }
}

async function bulkStock(db: DB, userId: string, b: Obj) {
  const updates = arr(b.updates, 200).map((u) => ({
    id: uid(u.variant_id),
    qty: int(u.stock_quantity, 0, 1_000_000, 'Stock')
  }))
  if (!updates.length) throw new HttpError(400, 'No updates supplied')
  const res = await Promise.all(
    updates.map((u) => db.from('product_variants').update({ stock_quantity: u.qty }).eq('id', u.id))
  )
  res.forEach((r) => check(r.error))
  await audit(db, userId, 'stock.bulk', 'variant', null, { count: updates.length })
  return { ok: true, updated: updates.length }
}

/* ---------- image upload (multipart) ---------- */
async function uploadImage(db: DB, req: Request) {
  const form = await req.formData()
  const file = form.get('file')
  if (!(file instanceof File)) throw new HttpError(400, 'No file uploaded')
  const ext = IMG_TYPES[file.type]
  if (!ext) throw new HttpError(400, 'Only JPG, PNG, WEBP or GIF images are allowed')
  if (file.size > 5 * 1024 * 1024) throw new HttpError(400, 'Image must be 5MB or smaller')
  const path = `catalog/${crypto.randomUUID()}.${ext}`
  const { error } = await db.storage
    .from(BUCKET)
    .upload(path, file, { contentType: file.type, cacheControl: '31536000' })
  if (error) {
    console.error(error)
    throw new HttpError(500, 'Upload failed')
  }
  return { url: db.storage.from(BUCKET).getPublicUrl(path).data.publicUrl, path }
}

/* ---------- router ---------- */
Deno.serve(
  handle(async (req, cors) => {
    requireMethod(req, 'GET', 'POST')
    const { user, db, role } = await requireRole(req, READ)
    const ok = (body: unknown) => reply(cors, body)

    if (req.method === 'GET') {
      const sp = new URL(req.url).searchParams
      switch (sp.get('resource')) {
        case 'collections':
          return ok(await listCollections(db))
        case 'products':
          return ok(await listProducts(db, sp))
        case 'product':
          return ok({ product: await getProduct(db, uid(sp.get('id'))) })
        case 'low_stock':
          return ok(await lowStock(db, sp))
        default:
          throw new HttpError(400, 'Unknown resource')
      }
    }

    if (!WRITE.includes(role)) throw new HttpError(403, 'Insufficient permissions')
    if ((req.headers.get('content-type') || '').includes('multipart/form-data'))
      return ok(await uploadImage(db, req))

    const b = await readJson(req)
    switch (b.action) {
  case 'sign_upload':
    return ok(await signUpload(db, b))

  case 'save_collection':
    return ok(await saveCollection(db, user.id, b))

  case 'delete_collection':
    return ok(await deleteCollection(db, user.id, b))

  case 'reorder_collections':
    return ok(await reorderCollections(db, user.id, b))

  case 'save_product':
    return ok(await saveProduct(db, user.id, b))

  case 'set_status':
    return ok(await setStatus(db, user.id, b))

  case 'delete_product':
    return ok(await deleteProduct(db, user.id, b))

  case 'adjust_stock':
    return ok(await adjustStock(db, user.id, b))

  case 'bulk_stock':
    return ok(await bulkStock(db, user.id, b))

  default:
    throw new HttpError(400, 'Unknown action')
}
  })
)
