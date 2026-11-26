const list = (v) => (Array.isArray(v) ? v : [])
const clean = (v) => (typeof v === 'string' ? v.trim() || null : (v ?? null))
export const human = (v) =>
  String(v || '')
    .replaceAll('_', ' ')
    .replace(/^./, (c) => c.toUpperCase())
const fields = {
  name: 'Name',
  slug: 'Shop URL name',
  sku: 'SKU',
  collection_id: 'Collection',
  product_type: 'Product type',
  status: 'Visibility',
  currency: 'Currency',
  price_kobo: 'Selling price',
  compare_at_price_kobo: 'Original price',
  short_description: 'Short description',
  description: 'Description',
  fabric: 'Fabric',
  care_instructions: 'Care instructions',
  is_featured: 'Featured',
  is_new_arrival: 'New arrival',
  is_customisable: 'Customisable',
  allow_backorder: 'Allow backorders',
  seo_title: 'Search title',
  seo_description: 'Search description',
  tagline: 'Tagline',
  is_active: 'Active',
  sort_order: 'Display order',
  size: 'Size',
  colour: 'Colour',
  stock_quantity: 'Stock',
  alt_text: 'Image description',
  is_primary: 'Primary media',
  media_type: 'Media type'
}
const productKeys = [
  'name',
  'slug',
  'sku',
  'collection_id',
  'product_type',
  'status',
  'currency',
  'price_kobo',
  'compare_at_price_kobo',
  'short_description',
  'description',
  'fabric',
  'care_instructions',
  'is_featured',
  'is_new_arrival',
  'is_customisable',
  'allow_backorder',
  'seo_title',
  'seo_description'
]
const collectionKeys = [
  'name',
  'slug',
  'tagline',
  'description',
  'is_active',
  'sort_order',
  'seo_title',
  'seo_description'
]
const variantKeys = ['sku', 'size', 'colour', 'price_kobo', 'stock_quantity', 'is_active']
export function money(v, c = 'NGN') {
  try {
    return new Intl.NumberFormat('en-NG', { style: 'currency', currency: c }).format(
      Number(v) / 100
    )
  } catch {
    return `${c} ${Number(v) / 100}`
  }
}
function display(k, v, c, names) {
  if (clean(v) === null) return 'Not set'
  if (k === 'collection_id') return names[v] || 'Collection unavailable'
  if (k.endsWith('_kobo')) return money(v, c)
  if (typeof v === 'boolean') return v ? 'Yes' : 'No'
  if (k === 'stock_quantity') return `${v} units`
  if (k === 'status' || k === 'product_type' || k === 'media_type') return human(v)
  return String(v)
}
function changes(a, b, keys, c, names, oldCurrency = c) {
  return keys
    .filter(
      (k) =>
        clean(a?.[k]) !== clean(b?.[k]) ||
        (k.endsWith('_kobo') && clean(b?.[k]) !== null && c !== oldCurrency)
    )
    .map((k) => ({
      label: fields[k],
      before: display(k, a?.[k], oldCurrency, names),
      after: display(k, b?.[k], c, names)
    }))
}
function mediaRows(a, b) {
  const old = list(a)
    .slice()
    .sort((x, y) => (x.sort_order ?? 0) - (y.sort_order ?? 0))
  const next = list(b)
  const used = new Set()
  const out = next.map((m, i) => {
    let j = old.findIndex(
      (x, k) => !used.has(k) && ((m.id && m.id === x.id) || m.image_url === x.image_url)
    )
    if (j < 0) return { kind: 'Added', after: m }
    used.add(j)
    const x = old[j]
    const diff = changes(x, m, ['alt_text', 'is_primary', 'media_type'], 'NGN', {})
    if (j !== i) diff.push({ label: 'Position', before: String(j + 1), after: String(i + 1) })
    return {
      kind: diff.length || x.image_url !== m.image_url ? 'Changed' : 'Unchanged',
      before: x,
      after: m,
      diff
    }
  })
  old.forEach((m, i) => {
    if (!used.has(i)) out.push({ kind: 'Removed', before: m })
  })
  return out
}
const variantName = (v) =>
  [v?.sku, v?.size && `Size ${v.size}`, v?.colour].filter(Boolean).join(' · ') || 'Variant'
export function present(r, names = {}) {
  const p = r.payload || {},
    s = r.previous_data || {},
    a = r.action
  const product = s.product || s,
    collection = s.collection || s
  const result = {
    action: human(a),
    entity: 'Inventory',
    name: 'Inventory items',
    fields: [],
    items: [],
    media: [],
    warning: ''
  }
  const add = (name, kind, diff) => result.items.push({ name, kind, diff })
  const c = p.product?.currency || product.currency || 'NGN'
  if (a === 'save_product' || a === 'delete_product') {
    const del = a === 'delete_product',
      create = !p.id
    const next = p.product || {}
    result.action = del ? 'Delete product' : create ? 'Create product' : 'Update product'
    result.entity = 'Product'
    result.name = next.name || product.name || 'Product'
    result.fields = changes(
      del || !create ? product : {},
      del ? {} : next,
      productKeys,
      c,
      names,
      product.currency || c
    )
    if (del)
      result.warning =
        'This product and its associated catalogue records will be removed if approved.'
    const old = list(s.variants || product.product_variants).filter((v) => v.is_active !== false)
    const incoming = del ? [] : Array.isArray(p.variants) ? p.variants : old
    const used = new Set()
    incoming.forEach((v) => {
      const x = old.find((o) => v.id && o.id === v.id)
      if (x) used.add(x.id)
      const diff = changes(x || {}, v, variantKeys, c, names, product.currency || c)
      if (!x || diff.length)
        add(variantName(v), !x ? 'Added' : v.is_active === false ? 'Deactivated' : 'Changed', diff)
    })
    old
      .filter((v) => !used.has(v.id))
      .forEach((v) =>
        add(variantName(v), del ? 'Removed' : 'Deactivated', changes(v, {}, variantKeys, c, names))
      )
    const oldMedia = s.images || product.product_images || []
    result.media = mediaRows(oldMedia, del ? [] : Array.isArray(p.images) ? p.images : oldMedia)
  } else if (a === 'save_collection' || a === 'delete_collection') {
    const del = a === 'delete_collection',
      create = !p.id
    result.action = del ? 'Delete collection' : create ? 'Create collection' : 'Update collection'
    result.entity = 'Collection'
    result.name = p.name || collection.name || 'Collection'
    const next = { ...p }
    if (!next.slug && next.name)
      next.slug = next.name
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-|-$/g, '')
    result.fields = changes(create ? {} : collection, del ? {} : next, collectionKeys, 'NGN', names)
    const cover = (x) =>
      x?.image_url ? [{ image_url: x.image_url, media_type: 'image', is_primary: true }] : []
    const old = list(s.media).length ? s.media : cover(collection)
    result.media = mediaRows(
      old,
      del ? [] : Array.isArray(p.media) ? p.media : p.image_url ? cover(p) : old
    )
    if (del)
      result.warning = `Collection will be deleted. ${list(s.products).length} associated product(s) may become uncategorised.`
  } else if (a === 'set_status') {
    result.action =
      p.status === 'active'
        ? 'Publish products'
        : p.status === 'archived'
          ? 'Archive products'
          : 'Move products to draft'
    result.entity = 'Product'
    result.name = `${list(p.ids).length} product(s)`
    list(s).forEach((x) =>
      add(
        x.name || 'Product',
        'Changed',
        changes(x, { status: p.status }, ['status'], x.currency, names)
      )
    )
  } else if (a === 'adjust_stock' || a === 'bulk_stock') {
    result.action = a === 'adjust_stock' ? 'Adjust stock' : 'Bulk stock adjustment'
    result.entity = 'Variant'
    result.name = a === 'adjust_stock' ? variantName(s) : `${list(p.updates).length} variant(s)`
    const updates =
      a === 'adjust_stock'
        ? [
            {
              variant_id: p.variant_id,
              stock_quantity:
                p.set ??
                (s.stock_quantity == null ? null : Number(s.stock_quantity) + Number(p.delta))
            }
          ]
        : list(p.updates)
    updates.forEach((u) => {
      const x = a === 'adjust_stock' ? s : list(s).find((v) => v.id === u.variant_id) || {}
      add(variantName(x), 'Changed', changes(x, u, ['stock_quantity'], 'NGN', names))
    })
  } else if (a === 'reorder_collections') {
    result.action = 'Reorder collections'
    result.entity = 'Collection'
    result.name = `${list(p.order).length} collection(s)`
    list(p.order).forEach((id, i) => {
      const x = list(s).find((v) => v.id === id) || {}
      const diff = changes(x, { sort_order: i + 1 }, ['sort_order'], 'NGN', names)
      if (diff.length) add(x.name || 'Collection', 'Changed', diff)
    })
  } else result.warning = 'This request type is not supported by the review display.'
  return result
}
export function mediaUrl(m) {
  try {
    const u = new URL(m?.image_url)
    return ['https:', 'http:'].includes(u.protocol) ? u.href : ''
  } catch {
    return ''
  }
}
