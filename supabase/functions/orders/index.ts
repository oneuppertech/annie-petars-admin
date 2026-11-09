import { handle, reply, readJson, requireMethod, text, HttpError } from '../_shared/http.ts'
import { requireRole } from '../_shared/supabaseAdmin.ts'

// deno-lint-ignore no-explicit-any
type DB = any
// deno-lint-ignore no-explicit-any
type Row = any
type Obj = Record<string, unknown>

/* ================================================================== */
/* Permissions                                                         */
/* ================================================================== */
const READ = ['owner', 'admin', 'order_manager', 'support']
const WRITE = ['owner', 'admin', 'order_manager']
const MONEY = ['owner', 'admin'] // record payments, refunds, price overrides

// Manual payment recording (bank transfer / cash / POS) bypasses the provider webhook.
// Set to false if payments must only ever be confirmed by verified webhooks.
const MANUAL_PAYMENTS_ENABLED = true

/* ================================================================== */
/* Constants                                                           */
/* ================================================================== */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
const DAY = 86_400_000
const TZ_MS = 3_600_000 // Africa/Lagos, UTC+1
const EXPORT_MAX = 5000

const STATUSES = [
  'pending_payment',
  'paid',
  'processing',
  'ready_to_ship',
  'shipped',
  'delivered',
  'cancelled',
  'refunded'
]
const PAID_STAGES = ['paid', 'processing', 'ready_to_ship', 'shipped', 'delivered']
const TRANSITIONS: Record<string, string[]> = {
  pending_payment: ['cancelled'],
  paid: ['processing', 'cancelled', 'refunded'],
  processing: ['ready_to_ship', 'shipped', 'cancelled', 'refunded'],
  ready_to_ship: ['processing', 'shipped', 'cancelled', 'refunded'],
  shipped: ['delivered', 'refunded'],
  delivered: ['refunded'],
  cancelled: [],
  refunded: []
}
const FROZEN = ['shipped', 'delivered', 'cancelled', 'refunded'] // address edits locked
const CLOSED = ['cancelled', 'refunded']
const SORTS = ['placed_at', 'updated_at', 'total_kobo', 'order_number']
const MANUAL_TYPES = ['bank_transfer', 'cash', 'pos', 'other']
const ADDR_KEYS = [
  'recipient_name',
  'phone',
  'address_line1',
  'address_line2',
  'city',
  'state_region',
  'postal_code',
  'country_code'
]

const LIST_COLS =
  'id,order_number,customer_id,email,phone,status,payment_status,currency,subtotal_kobo,shipping_kobo,discount_kobo,total_kobo,tracking_number,shipping_provider,placed_at,updated_at'

/* ================================================================== */
/* Helpers                                                             */
/* ================================================================== */
const uid = (v: unknown) => {
  if (typeof v !== 'string' || !UUID.test(v)) throw new HttpError(400, 'Invalid id')
  return v
}
const int = (v: unknown, min = 0, max = 1_000_000_000_000, label = 'Value') => {
  const n = Number(v)
  if (!Number.isInteger(n) || n < min || n > max) throw new HttpError(400, `${label} is invalid`)
  return n
}
const has = (v: unknown) => v !== undefined && v !== null && v !== ''
const arr = (v: unknown, max: number): Obj[] => (Array.isArray(v) ? (v.slice(0, max) as Obj[]) : [])
const naira = (kobo: number) => `₦${(Number(kobo) / 100).toLocaleString('en-NG', { minimumFractionDigits: 2 })}`

function cleanEmail(v: unknown) {
  const e = text(v, 254).toLowerCase()
  if (!EMAIL.test(e)) throw new HttpError(400, 'A valid email is required')
  return e
}

function check(error: { code?: string; message?: string } | null) {
  if (!error) return
  if (error.code === '23505') throw new HttpError(409, 'That value is already in use')
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
  entityId: string | null,
  metadata: Obj = {}
) =>
  db
    .from('audit_logs')
    .insert({ actor_user_id: userId, action, entity_type: 'order', entity_id: entityId, metadata })
    .then(() => {}, console.error)

const head = (db: DB, table: string, sel = 'id') =>
  db.from(table).select(sel, { count: 'exact', head: true })
async function count(q: Row) {
  const { count, error } = await q
  check(error)
  return (count ?? 0) as number
}

const pager = (sp: URLSearchParams, def = 20) => {
  const page = Math.max(1, Number(sp.get('page')) || 1)
  const size = Math.min(100, Math.max(1, Number(sp.get('limit')) || def))
  return { page, size, from: (page - 1) * size, to: page * size - 1 }
}
const search = (sp: URLSearchParams, key = 'q') =>
  (sp.get(key) || '')
    .replace(/[%,()*\\]/g, ' ')
    .trim()
    .slice(0, 80)

function dateParam(v: string | null, label: string, endOfDay = false) {
  if (!v) return null
  const iso = /^\d{4}-\d{2}-\d{2}$/.test(v)
    ? `${v}${endOfDay ? 'T23:59:59.999' : 'T00:00:00.000'}+01:00`
    : v
  const d = new Date(iso)
  if (isNaN(d.getTime())) throw new HttpError(400, `${label} is invalid`)
  return d.toISOString()
}
const dayKey = (iso: string) => new Date(Date.parse(iso) + TZ_MS).toISOString().slice(0, 10)
const startOfLagosDay = (ms: number) =>
  Date.parse(`${dayKey(new Date(ms).toISOString())}T00:00:00.000+01:00`)

function cleanAddress(v: unknown, required = false) {
  if (!v || typeof v !== 'object') {
    if (required) throw new HttpError(400, 'A shipping address is required')
    return null
  }
  const o = v as Obj
  const out: Obj = {}
  for (const k of ADDR_KEYS) {
    const s = text(o[k], 200)
    if (s) out[k] = s
  }
  if (required && (!out.address_line1 || !out.city))
    throw new HttpError(400, 'Address line 1 and city are required')
  return out
}

/* ================================================================== */
/* Stock                                                               */
/* ================================================================== */
async function adjustStock(db: DB, variantId: string, delta: number) {
  const { error } = await db.rpc('adjust_variant_stock', {
    p_variant: variantId,
    p_delta: delta,
    p_set: null
  })
  check(error)
}

// Applies +/- deltas per variant; rolls back everything it applied if one fails.
async function applyDeltas(db: DB, deltas: Map<string, number>) {
  const done: [string, number][] = []
  try {
    for (const [v, d] of deltas) {
      if (!d) continue
      await adjustStock(db, v, d)
      done.push([v, d])
    }
  } catch (e) {
    for (const [v, d] of done.reverse()) await adjustStock(db, v, -d).catch(console.error)
    throw e
  }
  return done
}
const rollback = async (db: DB, done: [string, number][]) => {
  for (const [v, d] of [...done].reverse()) await adjustStock(db, v, -d).catch(console.error)
}

// Stock is only "held" for an order when this endpoint reserved it (audit trail is the source of truth).
async function stockState(db: DB, orderId: string) {
  const { data, error } = await db
    .from('audit_logs')
    .select('action,metadata')
    .eq('entity_type', 'order')
    .eq('entity_id', orderId)
    .in('action', ['order.create', 'order.items', 'order.restock'])
    .order('created_at', { ascending: true })
  check(error)
  let held = false
  for (const l of data || []) {
    if (l.action === 'order.restock') held = false
    else held = l.metadata?.stock_reserved === true
  }
  return { held }
}

async function restockOrder(db: DB, orderId: string) {
  const { data, error } = await db
    .from('order_items')
    .select('variant_id,quantity')
    .eq('order_id', orderId)
    .not('variant_id', 'is', null)
  check(error)
  const deltas = new Map<string, number>()
  for (const i of data || [])
    deltas.set(i.variant_id, (deltas.get(i.variant_id) ?? 0) + Number(i.quantity))
  await applyDeltas(db, deltas)
  return (data || []).length
}

/* ================================================================== */
/* Item resolution (prices always come from the database)              */
/* ================================================================== */
async function resolveItems(db: DB, input: unknown, allowPriceOverride: boolean) {
  const raw = arr(input, 50)
  if (!raw.length) throw new HttpError(400, 'Add at least one item')
  const ids = [...new Set(raw.map((i) => uid(i.variant_id)))]
  const { data, error } = await db
    .from('product_variants')
    .select(
      'id,sku,size,colour,price_kobo,stock_quantity,is_active,products(id,name,slug,sku,status,price_kobo,allow_backorder,product_images(image_url,is_primary,sort_order))'
    )
    .in('id', ids)
  check(error)
  const byId = new Map<string, Row>((data || []).map((v: Row) => [v.id, v]))

  const demand = new Map<string, number>()
  const lines = raw.map((i) => {
    const v = byId.get(uid(i.variant_id))
    if (!v || !v.products) throw new HttpError(400, 'One of the items no longer exists')
    if (!v.is_active || v.products.status === 'archived')
      throw new HttpError(400, `${v.products.name} is no longer available`)
    const qty = int(i.quantity, 1, 1000, 'Quantity')
    const base = Number(v.price_kobo ?? v.products.price_kobo)
    const unit =
      allowPriceOverride && has(i.unit_price_kobo)
        ? int(i.unit_price_kobo, 0, undefined, 'Unit price')
        : base
    demand.set(v.id, (demand.get(v.id) ?? 0) + qty)
    const img = [...(v.products.product_images || [])].sort(
      (a: Row, b: Row) =>
        Number(b.is_primary) - Number(a.is_primary) || Number(a.sort_order) - Number(b.sort_order)
    )[0]
    return {
      variant: v,
      row: {
        product_id: v.products.id,
        variant_id: v.id,
        product_name: v.products.name,
        sku: v.sku ?? v.products.sku ?? null,
        size: v.size ?? null,
        colour: v.colour ?? null,
        quantity: qty,
        unit_price_kobo: unit,
        line_total_kobo: unit * qty,
        product_snapshot: {
          product_id: v.products.id,
          name: v.products.name,
          slug: v.products.slug,
          sku: v.products.sku ?? null,
          image: img?.image_url ?? null,
          catalog_price_kobo: base
        }
      }
    }
  })

  const subtotal = lines.reduce((n, l) => n + l.row.line_total_kobo, 0)
  return { lines, demand, byId, subtotal }
}

function assertStock(demand: Map<string, number>, byId: Map<string, Row>) {
  for (const [id, qty] of demand) {
    const v = byId.get(id)!
    if (!v.products.allow_backorder && Number(v.stock_quantity) < qty) {
      const opt = [v.size, v.colour].filter(Boolean).join(' / ')
      throw new HttpError(
        409,
        `Not enough stock for ${v.products.name}${opt ? ` (${opt})` : ''}: ${v.stock_quantity} available`
      )
    }
  }
}

/* ================================================================== */
/* Filters shared by list + export                                     */
/* ================================================================== */
function applyFilters(q: Row, sp: URLSearchParams) {
  const status = sp.get('status')
  if (status) {
    const list = status.split(',').map((s) => s.trim()).filter(Boolean)
    for (const s of list) if (!STATUSES.includes(s)) throw new HttpError(400, 'Invalid status')
    q = list.length === 1 ? q.eq('status', list[0]) : q.in('status', list)
  }
  const ps = sp.get('payment_status')
  if (ps) {
    const list = ps.split(',').map((s) => s.trim()).filter(Boolean)
    q = list.length === 1 ? q.eq('payment_status', list[0]) : q.in('payment_status', list)
  }
  const cid = sp.get('customer_id')
  if (cid) q = q.eq('customer_id', uid(cid))
  if (sp.get('guest') === 'true') q = q.is('customer_id', null)
  const provider = text(sp.get('provider'), 120)
  if (provider) q = q.eq('shipping_provider', provider)
  const ht = sp.get('has_tracking')
  if (ht === 'true') q = q.not('tracking_number', 'is', null)
  if (ht === 'false') q = q.is('tracking_number', null)
  if (has(sp.get('min_total'))) q = q.gte('total_kobo', int(sp.get('min_total'), 0, undefined, 'Min total'))
  if (has(sp.get('max_total'))) q = q.lte('total_kobo', int(sp.get('max_total'), 0, undefined, 'Max total'))
  const s = search(sp)
  if (s)
    q = q.or(
      `order_number.ilike.%${s}%,email.ilike.%${s}%,phone.ilike.%${s}%,tracking_number.ilike.%${s}%`
    )
  const f = dateParam(sp.get('from'), 'From date')
  const t = dateParam(sp.get('to'), 'To date', true)
  if (f) q = q.gte('placed_at', f)
  if (t) q = q.lte('placed_at', t)
  return q
}

function applySort(q: Row, sp: URLSearchParams) {
  const sort = sp.get('sort') || 'placed_at'
  if (!SORTS.includes(sort)) throw new HttpError(400, 'Invalid sort')
  return q.order(sort, { ascending: sp.get('dir') === 'asc' })
}

/* ================================================================== */
/* Reads                                                               */
/* ================================================================== */
async function listOrders(db: DB, sp: URLSearchParams) {
  const { page, size, from, to } = pager(sp)
  const q = applyFilters(
    db
      .from('orders')
      .select(`${LIST_COLS},customers(id,full_name),order_items(product_name,quantity)`, {
        count: 'exact'
      }),
    sp
  )
  const { data, count: total, error } = await applySort(q, sp).range(from, to)
  check(error)
  return {
    total: total ?? 0,
    page,
    limit: size,
    orders: (data || []).map(({ order_items, customers, ...o }: Row) => ({
      ...o,
      customer: customers ?? null,
      item_count: (order_items || []).reduce((n: number, i: Row) => n + Number(i.quantity), 0),
      items_preview: (order_items || []).slice(0, 3).map((i: Row) => `${i.product_name} ×${i.quantity}`),
      allowed_next_statuses: TRANSITIONS[o.status] ?? []
    }))
  }
}

async function getOrder(db: DB, id: string) {
  const [o, pay, tl] = await Promise.all([
    db
      .from('orders')
      .select('*, order_items(*), customers(id,full_name,email,phone,created_at)')
      .eq('id', id)
      .maybeSingle(),
    db
      .from('payments')
      .select('id,provider,provider_reference,status,amount_kobo,currency,verified_at,created_at')
      .eq('order_id', id)
      .order('created_at', { ascending: false }),
    db
      .from('audit_logs')
      .select('id,action,actor_user_id,metadata,created_at')
      .eq('entity_type', 'order')
      .eq('entity_id', id)
      .order('created_at', { ascending: false })
      .limit(100)
  ])
  check(o.error)
  check(pay.error)
  check(tl.error)
  if (!o.data) throw new HttpError(404, 'Order not found')
  const { order_items, customers, ...order } = o.data

  const items = [...(order_items || [])].sort((a: Row, b: Row) =>
    String(a.created_at).localeCompare(String(b.created_at))
  )
  const vids = items.map((i: Row) => i.variant_id).filter(Boolean)
  const [vs, st, custOrders] = await Promise.all([
    vids.length
      ? db.from('product_variants').select('id,stock_quantity,is_active').in('id', vids)
      : Promise.resolve({ data: [], error: null }),
    stockState(db, id),
    order.customer_id ? count(head(db, 'orders').eq('customer_id', order.customer_id)) : 0
  ])
  check(vs.error)
  const stock = new Map<string, Row>((vs.data || []).map((v: Row) => [v.id, v]))

  const itemsSum = items.reduce((n: number, i: Row) => n + Number(i.line_total_kobo), 0)
  const paid = (pay.data || [])
    .filter((p: Row) => p.status === 'paid')
    .reduce((n: number, p: Row) => n + Number(p.amount_kobo), 0)

  return {
    order: {
      ...order,
      customer: customers ?? null,
      customer_order_count: custOrders,
      items: items.map((i: Row) => ({
        ...i,
        current_stock: stock.get(i.variant_id)?.stock_quantity ?? null,
        variant_active: stock.get(i.variant_id)?.is_active ?? null
      }))
    },
    payments: pay.data || [],
    timeline: tl.data || [],
    allowed_next_statuses: TRANSITIONS[order.status] ?? [],
    flags: {
      stock_held: st.held,
      editable_items: order.status === 'pending_payment' && order.payment_status !== 'paid',
      editable_address: !FROZEN.includes(order.status)
    },
    reconciliation: {
      items_total_kobo: itemsSum,
      subtotal_matches_items: itemsSum === Number(order.subtotal_kobo),
      total_matches_parts:
        Number(order.subtotal_kobo) + Number(order.shipping_kobo) - Number(order.discount_kobo) ===
        Number(order.total_kobo),
      paid_kobo: paid,
      payment_matches_total: paid === Number(order.total_kobo)
    }
  }
}

async function orderStats(db: DB, sp: URLSearchParams) {
  const now = Date.now()
  const to = dateParam(sp.get('to'), 'To date', true) ?? new Date(now).toISOString()
  const from =
    dateParam(sp.get('from'), 'From date') ??
    new Date(startOfLagosDay(Date.parse(to)) - 29 * DAY).toISOString()
  if (Date.parse(from) > Date.parse(to)) throw new HttpError(400, 'From must be before To')
  if (Date.parse(to) - Date.parse(from) > 366 * DAY) throw new HttpError(400, 'Range is too large')

  const iso = (ms: number) => new Date(ms).toISOString()
  const [{ data, error }, unpaid, stuckFulfil, stuckShipped] = await Promise.all([
    db
      .from('orders')
      .select('status,payment_status,total_kobo,placed_at,shipping_provider,customer_id')
      .gte('placed_at', from)
      .lte('placed_at', to)
      .limit(10000),
    count(head(db, 'orders').eq('status', 'pending_payment').lt('placed_at', iso(now - DAY))),
    count(
      head(db, 'orders')
        .in('status', ['paid', 'processing', 'ready_to_ship'])
        .lt('updated_at', iso(now - 2 * DAY))
    ),
    count(head(db, 'orders').eq('status', 'shipped').lt('updated_at', iso(now - 7 * DAY)))
  ])
  check(error)

  const byStatus: Record<string, { count: number; total_kobo: number }> = {}
  const byPayment: Record<string, number> = {}
  const byProvider: Record<string, number> = {}
  const byDay = new Map<string, { orders: number; revenue_kobo: number }>()
  const customers = new Set<string>()
  let revenue = 0
  let paidOrders = 0
  let refunded = 0
  let guest = 0

  for (const o of data || []) {
    const s = (byStatus[o.status] ??= { count: 0, total_kobo: 0 })
    s.count++
    s.total_kobo += Number(o.total_kobo)
    byPayment[o.payment_status] = (byPayment[o.payment_status] ?? 0) + 1
    if (o.shipping_provider && ['shipped', 'delivered'].includes(o.status))
      byProvider[o.shipping_provider] = (byProvider[o.shipping_provider] ?? 0) + 1
    if (o.customer_id) customers.add(o.customer_id)
    else guest++
    if (o.status === 'refunded') refunded += Number(o.total_kobo)
    if (o.payment_status === 'paid' && !CLOSED.includes(o.status)) {
      revenue += Number(o.total_kobo)
      paidOrders++
      const k = dayKey(o.placed_at)
      const d = byDay.get(k) ?? { orders: 0, revenue_kobo: 0 }
      d.orders++
      d.revenue_kobo += Number(o.total_kobo)
      byDay.set(k, d)
    }
  }

  const series: { date: string; orders: number; revenue_kobo: number }[] = []
  const endKey = dayKey(to)
  for (let t = Date.parse(from), i = 0; i < 400; t += DAY, i++) {
    const k = dayKey(iso(t))
    const d = byDay.get(k)
    series.push({ date: k, orders: d?.orders ?? 0, revenue_kobo: d?.revenue_kobo ?? 0 })
    if (k >= endKey) break
  }

  return {
    from,
    to,
    totals: {
      orders: (data || []).length,
      paid_orders: paidOrders,
      revenue_kobo: revenue,
      avg_order_kobo: paidOrders ? Math.round(revenue / paidOrders) : 0,
      refunded_kobo: refunded,
      unique_customers: customers.size,
      guest_orders: guest
    },
    by_status: byStatus,
    by_payment_status: byPayment,
    by_provider: byProvider,
    series,
    attention: {
      unpaid_over_24h: unpaid,
      to_fulfil_over_48h: stuckFulfil,
      shipped_over_7d: stuckShipped
    },
    truncated: (data || []).length >= 10000
  }
}

/* CSV export (returned inside JSON so the frontend can download it) */
const csvCell = (v: unknown) => {
  let s = v === null || v === undefined ? '' : String(v)
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}` // block spreadsheet formula injection
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}
async function exportOrders(db: DB, sp: URLSearchParams) {
  const q = applyFilters(
    db
      .from('orders')
      .select(
        `${LIST_COLS},shipping_address,customer_note,customers(full_name),order_items(product_name,size,colour,quantity)`
      ),
    sp
  )
  const { data, error } = await applySort(q, sp).limit(EXPORT_MAX)
  check(error)
  const head = [
    'Order',
    'Placed',
    'Status',
    'Payment',
    'Customer',
    'Email',
    'Phone',
    'Items',
    'Subtotal',
    'Shipping',
    'Discount',
    'Total',
    'Currency',
    'Provider',
    'Tracking',
    'City',
    'State',
    'Customer note'
  ]
  const money = (k: number) => (Number(k) / 100).toFixed(2)
  const lines = [head.join(',')]
  for (const o of data || []) {
    const a = o.shipping_address || {}
    lines.push(
      [
        o.order_number,
        o.placed_at,
        o.status,
        o.payment_status,
        o.customers?.full_name ?? a.recipient_name ?? 'Guest',
        o.email,
        o.phone,
        (o.order_items || [])
          .map(
            (i: Row) =>
              `${i.product_name}${[i.size, i.colour].filter(Boolean).length ? ` (${[i.size, i.colour].filter(Boolean).join('/')})` : ''} x${i.quantity}`
          )
          .join('; '),
        money(o.subtotal_kobo),
        money(o.shipping_kobo),
        money(o.discount_kobo),
        money(o.total_kobo),
        o.currency,
        o.shipping_provider,
        o.tracking_number,
        a.city,
        a.state_region,
        o.customer_note
      ]
        .map(csvCell)
        .join(',')
    )
  }
  return {
    filename: `orders-${dayKey(new Date().toISOString())}.csv`,
    count: (data || []).length,
    truncated: (data || []).length >= EXPORT_MAX,
    csv: '\uFEFF' + lines.join('\n') // BOM so Excel reads ₦/accents correctly
  }
}

async function invoiceData(db: DB, id: string) {
  const [detail, biz] = await Promise.all([
    getOrder(db, id),
    db.from('shop_settings').select('value').eq('key', 'business').maybeSingle()
  ])
  return {
    ...detail,
    business: biz.data?.value ?? null,
    generated_at: new Date().toISOString()
  }
}

/* lookups used by the "create order" form */
async function lookupVariants(db: DB, sp: URLSearchParams) {
  const s = search(sp)
  if (!s) return { variants: [] }
  const { data: prods } = await db
    .from('products')
    .select('id')
    .neq('status', 'archived')
    .or(`name.ilike.%${s}%,sku.ilike.%${s}%`)
    .limit(50)
  const ids = (prods || []).map((p: Row) => p.id)
  const { data, error } = await db
    .from('product_variants')
    .select(
      'id,sku,size,colour,price_kobo,stock_quantity,is_active,products!inner(id,name,sku,status,price_kobo,allow_backorder)'
    )
    .eq('is_active', true)
    .neq('products.status', 'archived')
    .or(ids.length ? `sku.ilike.%${s}%,product_id.in.(${ids.join(',')})` : `sku.ilike.%${s}%`)
    .limit(40)
  check(error)
  return {
    variants: (data || []).map(({ products, ...v }: Row) => ({
      ...v,
      product_id: products.id,
      product_name: products.name,
      allow_backorder: products.allow_backorder,
      effective_price_kobo: Number(v.price_kobo ?? products.price_kobo)
    }))
  }
}

async function lookupCustomers(db: DB, sp: URLSearchParams) {
  const s = search(sp)
  if (!s) return { customers: [] }
  const { data, error } = await db
    .from('customers')
    .select('id,full_name,email,phone')
    .or(`full_name.ilike.%${s}%,email.ilike.%${s}%,phone.ilike.%${s}%`)
    .limit(10)
  check(error)
  return { customers: data || [] }
}

/* ================================================================== */
/* Payments (manual) & refunds                                         */
/* ================================================================== */
async function recordPayment(
  db: DB,
  userId: string,
  o: Row,
  input: { type: string; reference: string; amount_kobo?: unknown; note?: string }
) {
  if (!MANUAL_PAYMENTS_ENABLED) throw new HttpError(403, 'Manual payments are disabled')
  if (o.status !== 'pending_payment' || o.payment_status === 'paid')
    throw new HttpError(409, 'Only unpaid orders awaiting payment can be marked as paid')
  if (!MANUAL_TYPES.includes(input.type))
    throw new HttpError(400, `Payment type must be one of: ${MANUAL_TYPES.join(', ')}`)
  if (!input.reference) throw new HttpError(400, 'A payment reference is required')
  const amount = has(input.amount_kobo) ? int(input.amount_kobo, 1, undefined, 'Amount') : Number(o.total_kobo)
  if (amount !== Number(o.total_kobo))
    throw new HttpError(400, `Amount must equal the order total (${naira(o.total_kobo)})`)

  const now = new Date().toISOString()
  const ins = await db
    .from('payments')
    .insert({
      order_id: o.id,
      provider: `manual_${input.type}`,
      provider_reference: input.reference,
      status: 'paid',
      amount_kobo: amount,
      currency: o.currency || 'NGN',
      verified_at: now,
      raw_response: { manual: true, recorded_by: userId, note: input.note || null }
    })
    .select('id')
    .single()
  check(ins.error)

  const upd = await db
    .from('orders')
    .update({ payment_status: 'paid', status: 'paid' })
    .eq('id', o.id)
  if (upd.error) {
    await db.from('payments').delete().eq('id', ins.data.id) // compensate
    check(upd.error)
  }
  await audit(db, userId, 'order.payment_recorded', o.id, {
    type: input.type,
    reference: input.reference,
    amount_kobo: amount,
    note: input.note || null
  })
}

async function recordPaymentAction(db: DB, userId: string, b: Obj) {
  const id = uid(b.id)
  const { data: o, error } = await db
    .from('orders')
    .select('id,status,payment_status,total_kobo,currency')
    .eq('id', id)
    .maybeSingle()
  check(error)
  if (!o) throw new HttpError(404, 'Order not found')
  await recordPayment(db, userId, o, {
    type: String(b.type || ''),
    reference: text(b.reference, 120),
    amount_kobo: b.amount_kobo,
    note: text(b.note, 500)
  })
  return await getOrder(db, id)
}

async function refundOrder(db: DB, userId: string, b: Obj) {
  const id = uid(b.id)
  const reason = text(b.reason, 500)
  if (!reason) throw new HttpError(400, 'A refund reason is required')
  const { data: o, error } = await db
    .from('orders')
    .select('id,status,payment_status,total_kobo')
    .eq('id', id)
    .maybeSingle()
  check(error)
  if (!o) throw new HttpError(404, 'Order not found')
  if (o.payment_status !== 'paid') throw new HttpError(409, 'Only paid orders can be refunded')
  if (CLOSED.includes(o.status)) throw new HttpError(409, `This order is already ${o.status}`)

  const amount = has(b.amount_kobo) ? int(b.amount_kobo, 1, Number(o.total_kobo), 'Refund amount') : Number(o.total_kobo)
  const reference = text(b.reference, 120) || null

  if (amount < Number(o.total_kobo)) {
    // Partial refunds are recorded for the audit trail; the order stays as is.
    await audit(db, userId, 'order.partial_refund', id, { amount_kobo: amount, reason, reference })
    return await getOrder(db, id)
  }

  await changeStatus(db, userId, id, 'refunded', {
    note: reason,
    restock: typeof b.restock === 'boolean' ? b.restock : undefined
  })
  // Mirror on payment rows where the enum allows it (ignored if the enum has no 'refunded')
  for (const [table, filter] of [
    ['orders', 'id'],
    ['payments', 'order_id']
  ] as const) {
    const patch = table === 'orders' ? { payment_status: 'refunded' } : { status: 'refunded' }
    const q = db.from(table).update(patch).eq(filter, id)
    const r = await (table === 'payments' ? q.eq('status', 'paid') : q)
    if (r.error && r.error.code !== '22P02') check(r.error)
  }
  await audit(db, userId, 'order.refund', id, { amount_kobo: amount, reason, reference })
  return await getOrder(db, id)
}

/* ================================================================== */
/* Status changes                                                      */
/* ================================================================== */
async function changeStatus(
  db: DB,
  userId: string,
  id: string,
  next: string,
  opts: { provider?: string | null; tracking?: string | null; note?: string; restock?: boolean } = {}
) {
  if (!STATUSES.includes(next)) throw new HttpError(400, 'Invalid status')
  const { data: o, error } = await db
    .from('orders')
    .select('id,status,payment_status,shipping_provider,tracking_number')
    .eq('id', id)
    .maybeSingle()
  check(error)
  if (!o) throw new HttpError(404, 'Order not found')
  if (o.status === next) throw new HttpError(409, `The order is already ${next}`)
  if (!(TRANSITIONS[o.status] ?? []).includes(next))
    throw new HttpError(409, `An order that is ${o.status} cannot move to ${next}`)
  // Payment is confirmed by the provider webhook (or an explicit, audited manual record), never by a status change
  if (PAID_STAGES.includes(next) && o.payment_status !== 'paid')
    throw new HttpError(409, 'Payment has not been verified for this order yet')

  const patch: Obj = { status: next }
  if (opts.provider !== undefined) patch.shipping_provider = opts.provider
  if (opts.tracking !== undefined) patch.tracking_number = opts.tracking
  if (next === 'shipped' && !((patch.shipping_provider ?? o.shipping_provider) as string | null))
    throw new HttpError(400, 'A shipping provider is required to mark as shipped')

  check((await db.from('orders').update(patch).eq('id', id)).error)

  let restocked = 0
  if (CLOSED.includes(next)) {
    const st = await stockState(db, id)
    const want = opts.restock === true || (opts.restock === undefined && st.held)
    // After a restock, `held` is false, so a second cancel/refund can't double-restock by default.
    if (want && (st.held || opts.restock === true)) {
      restocked = await restockOrder(db, id)
      await audit(db, userId, 'order.restock', id, { items: restocked })
    }
  }
  await audit(db, userId, 'order.status', id, {
    from: o.status,
    to: next,
    note: opts.note || null,
    restocked
  })
  return { from: o.status, to: next, restocked }
}

async function updateStatus(db: DB, userId: string, b: Obj) {
  const id = uid(b.id)
  await changeStatus(db, userId, id, String(b.status), {
    provider: 'shipping_provider' in b ? text(b.shipping_provider, 120) || null : undefined,
    tracking: 'tracking_number' in b ? text(b.tracking_number, 120) || null : undefined,
    note: text(b.note, 500),
    restock: typeof b.restock === 'boolean' ? b.restock : undefined
  })
  return await getOrder(db, id)
}

async function bulkStatus(db: DB, userId: string, b: Obj) {
  const ids = [...new Set((Array.isArray(b.ids) ? b.ids : []).slice(0, 100).map(uid))]
  if (!ids.length) throw new HttpError(400, 'No orders selected')
  const status = String(b.status)
  const provider = 'shipping_provider' in b ? text(b.shipping_provider, 120) || null : undefined
  const results: { id: string; ok: boolean; error?: string }[] = []
  for (const id of ids) {
    try {
      await changeStatus(db, userId, id, status, {
        provider,
        note: text(b.note, 500),
        restock: typeof b.restock === 'boolean' ? b.restock : undefined
      })
      results.push({ id, ok: true })
    } catch (e) {
      results.push({ id, ok: false, error: e instanceof HttpError ? e.message : 'Failed' })
    }
  }
  await audit(db, userId, 'order.bulk_status', null, {
    status,
    ids,
    succeeded: results.filter((r) => r.ok).length
  })
  return {
    ok: results.every((r) => r.ok),
    updated: results.filter((r) => r.ok).length,
    failed: results.filter((r) => !r.ok).length,
    results
  }
}

/* ================================================================== */
/* Edits                                                               */
/* ================================================================== */
async function lockedOrder(db: DB, id: string, cols = 'id,status,payment_status') {
  const { data, error } = await db.from('orders').select(cols).eq('id', id).maybeSingle()
  check(error)
  if (!data) throw new HttpError(404, 'Order not found')
  return data as Row
}

async function updateShipping(db: DB, userId: string, b: Obj) {
  const id = uid(b.id)
  const o = await lockedOrder(db, id, 'id,status,shipping_provider,tracking_number')
  if (CLOSED.includes(o.status)) throw new HttpError(409, `A ${o.status} order cannot be changed`)
  if (['pending_payment'].includes(o.status))
    throw new HttpError(409, 'Shipping details can be added once the order is paid')
  const patch: Obj = {}
  if ('shipping_provider' in b) patch.shipping_provider = text(b.shipping_provider, 120) || null
  if ('tracking_number' in b) patch.tracking_number = text(b.tracking_number, 120) || null
  if (!Object.keys(patch).length) throw new HttpError(400, 'Nothing to update')
  if (o.status === 'shipped' && 'shipping_provider' in patch && !patch.shipping_provider)
    throw new HttpError(400, 'A shipped order needs a shipping provider')
  check((await db.from('orders').update(patch).eq('id', id)).error)
  await audit(db, userId, 'order.shipping', id, {
    from: { provider: o.shipping_provider, tracking: o.tracking_number },
    to: patch
  })
  return await getOrder(db, id)
}

async function updateAddress(db: DB, userId: string, b: Obj) {
  const id = uid(b.id)
  const o = await lockedOrder(db, id, 'id,status,shipping_address,billing_address')
  if (FROZEN.includes(o.status))
    throw new HttpError(409, `The address of a ${o.status} order can't be changed`)
  const patch: Obj = {}
  // Merge so keys written by the storefront checkout (which may differ from ADDR_KEYS) aren't lost
  if (b.shipping_address) {
    const a = cleanAddress(b.shipping_address, true)
    patch.shipping_address = { ...(o.shipping_address || {}), ...a }
  }
  if (b.billing_address) {
    const a = cleanAddress(b.billing_address)
    patch.billing_address = { ...(o.billing_address || {}), ...a }
  }
  if (!Object.keys(patch).length) throw new HttpError(400, 'Nothing to update')
  check((await db.from('orders').update(patch).eq('id', id)).error)
  await audit(db, userId, 'order.address', id, { fields: Object.keys(patch) })
  return await getOrder(db, id)
}

async function updateContact(db: DB, userId: string, b: Obj) {
  const id = uid(b.id)
  await lockedOrder(db, id)
  const patch: Obj = {}
  if ('email' in b) patch.email = cleanEmail(b.email)
  if ('phone' in b) patch.phone = text(b.phone, 40) || null
  if (!Object.keys(patch).length) throw new HttpError(400, 'Nothing to update')
  check((await db.from('orders').update(patch).eq('id', id)).error)
  await audit(db, userId, 'order.contact', id, { fields: Object.keys(patch) })
  return await getOrder(db, id)
}

async function updateNotes(db: DB, userId: string, b: Obj) {
  const id = uid(b.id)
  await lockedOrder(db, id)
  const patch: Obj = {}
  if ('internal_note' in b) patch.internal_note = text(b.internal_note, 4000) || null
  if ('customer_note' in b) patch.customer_note = text(b.customer_note, 2000) || null
  if (!Object.keys(patch).length) throw new HttpError(400, 'Nothing to update')
  check((await db.from('orders').update(patch).eq('id', id)).error)
  await audit(db, userId, 'order.notes', id, { fields: Object.keys(patch) })
  return await getOrder(db, id)
}

// Timeline note (support can use this); never overwrites the internal note
async function addNote(db: DB, userId: string, b: Obj) {
  const id = uid(b.id)
  const note = text(b.note, 1000)
  if (!note) throw new HttpError(400, 'Note is empty')
  await lockedOrder(db, id)
  await audit(db, userId, 'order.note', id, { note })
  return await getOrder(db, id)
}

async function attachCustomer(db: DB, userId: string, b: Obj) {
  const id = uid(b.id)
  await lockedOrder(db, id)
  const customerId = b.customer_id ? uid(b.customer_id) : null
  if (customerId) {
    const { data, error } = await db.from('customers').select('id').eq('id', customerId).maybeSingle()
    check(error)
    if (!data) throw new HttpError(404, 'Customer not found')
  }
  check((await db.from('orders').update({ customer_id: customerId }).eq('id', id)).error)
  await audit(db, userId, 'order.customer', id, { customer_id: customerId })
  return await getOrder(db, id)
}

async function updateTotals(db: DB, userId: string, role: string, b: Obj) {
  const id = uid(b.id)
  const o = await lockedOrder(
    db,
    id,
    'id,status,payment_status,subtotal_kobo,shipping_kobo,discount_kobo,total_kobo'
  )
  if (o.status !== 'pending_payment' || o.payment_status === 'paid')
    throw new HttpError(409, 'Amounts can only change while the order awaits payment')
  const shipping = has(b.shipping_kobo) ? int(b.shipping_kobo, 0, undefined, 'Shipping') : Number(o.shipping_kobo)
  const discount = has(b.discount_kobo) ? int(b.discount_kobo, 0, undefined, 'Discount') : Number(o.discount_kobo)
  if (has(b.discount_kobo) && discount !== Number(o.discount_kobo) && !MONEY.includes(role))
    throw new HttpError(403, 'Only an owner or admin can change discounts')

  const { data: items, error } = await db.from('order_items').select('line_total_kobo').eq('order_id', id)
  check(error)
  const subtotal = (items || []).reduce((n: number, i: Row) => n + Number(i.line_total_kobo), 0)
  const total = subtotal + shipping - discount
  if (total < 0) throw new HttpError(400, 'Discount cannot exceed the order value')
  check(
    (
      await db
        .from('orders')
        .update({ subtotal_kobo: subtotal, shipping_kobo: shipping, discount_kobo: discount, total_kobo: total })
        .eq('id', id)
    ).error
  )
  await audit(db, userId, 'order.totals', id, {
    from: { shipping: o.shipping_kobo, discount: o.discount_kobo, total: o.total_kobo },
    to: { shipping, discount, total }
  })
  return await getOrder(db, id)
}

async function editItems(db: DB, userId: string, role: string, b: Obj) {
  const id = uid(b.id)
  const o = await lockedOrder(
    db,
    id,
    'id,status,payment_status,shipping_kobo,discount_kobo'
  )
  if (o.status !== 'pending_payment' || o.payment_status === 'paid')
    throw new HttpError(409, 'Items can only change while the order awaits payment')

  const { lines, byId, subtotal } = await resolveItems(db, b.items, MONEY.includes(role))
  const total = subtotal + Number(o.shipping_kobo) - Number(o.discount_kobo)
  if (total < 0) throw new HttpError(400, 'Discount cannot exceed the order value')

  const { data: oldItems, error } = await db
    .from('order_items')
    .select('id,variant_id,quantity')
    .eq('order_id', id)
  check(error)

  // Stock moves only if this endpoint is holding stock for the order
  const st = await stockState(db, id)
  let applied: [string, number][] = []
  if (st.held) {
    const net = new Map<string, number>()
    for (const i of oldItems || [])
      if (i.variant_id) net.set(i.variant_id, (net.get(i.variant_id) ?? 0) + Number(i.quantity))
    for (const l of lines) net.set(l.variant.id, (net.get(l.variant.id) ?? 0) - l.row.quantity)
    for (const [v, d] of net) if (d < 0) {
      const variant = byId.get(v)
      if (variant && !variant.products.allow_backorder && Number(variant.stock_quantity) < -d)
        throw new HttpError(409, `Not enough stock for ${variant.products.name}`)
    }
    applied = await applyDeltas(db, net)
  }

  try {
    const ins = await db
      .from('order_items')
      .insert(lines.map((l) => ({ ...l.row, order_id: id })))
      .select('id')
    check(ins.error)
    const del = await db.from('order_items').delete().in('id', (oldItems || []).map((i: Row) => i.id))
    if (del.error) {
      await db.from('order_items').delete().in('id', (ins.data || []).map((i: Row) => i.id))
      check(del.error)
    }
    check(
      (await db.from('orders').update({ subtotal_kobo: subtotal, total_kobo: total }).eq('id', id)).error
    )
  } catch (e) {
    await rollback(db, applied)
    throw e
  }
  await audit(db, userId, 'order.items', id, {
    stock_reserved: st.held,
    items: lines.length,
    subtotal_kobo: subtotal,
    total_kobo: total
  })
  return await getOrder(db, id)
}

/* ================================================================== */
/* Create (phone / WhatsApp / walk-in orders)                          */
/* ================================================================== */
async function createOrder(db: DB, userId: string, role: string, b: Obj) {
  const isMoney = MONEY.includes(role)

  // Customer: attach existing, find by email, or create when a name is supplied
  let customerId = b.customer_id ? uid(b.customer_id) : null
  let email = has(b.email) ? cleanEmail(b.email) : ''
  if (customerId) {
    const { data, error } = await db
      .from('customers')
      .select('id,email,phone')
      .eq('id', customerId)
      .maybeSingle()
    check(error)
    if (!data) throw new HttpError(404, 'Customer not found')
    email = email || data.email
  }
  if (!email) throw new HttpError(400, 'A valid email is required')
  const phone = text(b.phone, 40) || null

  const shipping_address = cleanAddress(b.shipping_address, true)!
  const billing_address = cleanAddress(b.billing_address) ?? shipping_address
  const shipping = has(b.shipping_kobo) ? int(b.shipping_kobo, 0, undefined, 'Shipping') : 0
  const discount = has(b.discount_kobo) ? int(b.discount_kobo, 0, undefined, 'Discount') : 0
  if (discount > 0 && !isMoney) throw new HttpError(403, 'Only an owner or admin can apply discounts')
  const reserve = b.reserve_stock !== false

  const { lines, demand, byId, subtotal } = await resolveItems(db, b.items, isMoney)
  const total = subtotal + shipping - discount
  if (total < 0) throw new HttpError(400, 'Discount cannot exceed the order value')
  if (reserve) assertStock(demand, byId)

  if (!customerId && text(b.full_name, 160)) {
    const escaped = email.replace(/[\\%_]/g, '\\$&')
    const { data: ex } = await db.from('customers').select('id').ilike('email', escaped).maybeSingle()
    if (ex) customerId = ex.id
    else {
      const ins = await db
        .from('customers')
        .insert({ full_name: text(b.full_name, 160), email, phone })
        .select('id')
        .single()
      check(ins.error)
      customerId = ins.data.id
    }
  }

  const { data: order, error } = await db
    .from('orders')
    .insert({
      customer_id: customerId,
      email,
      phone,
      status: 'pending_payment',
      payment_status: 'unpaid',
      currency: 'NGN',
      subtotal_kobo: subtotal,
      shipping_kobo: shipping,
      discount_kobo: discount,
      total_kobo: total,
      shipping_address,
      billing_address,
      customer_note: text(b.customer_note, 2000) || null,
      internal_note: text(b.internal_note, 4000) || null
    })
    .select('id,status,payment_status,total_kobo,currency')
    .single()
  check(error)

  let applied: [string, number][] = []
  try {
    check((await db.from('order_items').insert(lines.map((l) => ({ ...l.row, order_id: order.id })))).error)
    if (reserve) {
      const deltas = new Map<string, number>()
      for (const [v, q] of demand) deltas.set(v, -q)
      applied = await applyDeltas(db, deltas)
    }
  } catch (e) {
    await rollback(db, applied)
    await db.from('order_items').delete().eq('order_id', order.id)
    await db.from('orders').delete().eq('id', order.id)
    throw e
  }

  await audit(db, userId, 'order.create', order.id, {
    source: 'admin',
    stock_reserved: reserve,
    items: lines.length,
    total_kobo: total
  })

  // Optionally record that the customer has already paid (owner/admin only)
  if (b.payment && typeof b.payment === 'object') {
    if (!isMoney) throw new HttpError(403, 'Only an owner or admin can record payments')
    const p = b.payment as Obj
    await recordPayment(db, userId, order, {
      type: String(p.type || ''),
      reference: text(p.reference, 120),
      note: text(p.note, 500)
    })
  }
  return await getOrder(db, order.id)
}

/* ================================================================== */
/* Router                                                              */
/* ================================================================== */
Deno.serve(
  handle(async (req, cors) => {
    requireMethod(req, 'GET', 'POST')
    const { user, db, role } = await requireRole(req, READ)
    const ok = (body: unknown) => reply(cors, body)
    const needWrite = () => {
      if (!WRITE.includes(role)) throw new HttpError(403, 'Insufficient permissions')
    }
    const needMoney = () => {
      if (!MONEY.includes(role)) throw new HttpError(403, 'Only an owner or admin can do this')
    }

    if (req.method === 'GET') {
      const sp = new URL(req.url).searchParams
      switch (sp.get('resource') || 'list') {
        case 'list':
          return ok(await listOrders(db, sp))
        case 'order':
          return ok(await getOrder(db, uid(sp.get('id'))))
        case 'stats':
          return ok(await orderStats(db, sp))
        case 'invoice':
          return ok(await invoiceData(db, uid(sp.get('id'))))
        case 'export':
          needWrite()
          return ok(await exportOrders(db, sp))
        case 'variants':
          needWrite()
          return ok(await lookupVariants(db, sp))
        case 'customers':
          needWrite()
          return ok(await lookupCustomers(db, sp))
        default:
          throw new HttpError(400, 'Unknown resource')
      }
    }

    const b = await readJson(req)
    switch (b.action) {
      // Everyone with access can annotate the timeline
      case 'add_note':
        return ok(await addNote(db, user.id, b))

      case 'create_order':
        needWrite()
        return ok(await createOrder(db, user.id, role, b))
      case 'update_status':
        needWrite()
        return ok(await updateStatus(db, user.id, b))
      case 'bulk_status':
        needWrite()
        return ok(await bulkStatus(db, user.id, b))
      case 'update_shipping':
        needWrite()
        return ok(await updateShipping(db, user.id, b))
      case 'update_address':
        needWrite()
        return ok(await updateAddress(db, user.id, b))
      case 'update_contact':
        needWrite()
        return ok(await updateContact(db, user.id, b))
      case 'update_notes':
        needWrite()
        return ok(await updateNotes(db, user.id, b))
      case 'attach_customer':
        needWrite()
        return ok(await attachCustomer(db, user.id, b))
      case 'update_totals':
        needWrite()
        return ok(await updateTotals(db, user.id, role, b))
      case 'edit_items':
        needWrite()
        return ok(await editItems(db, user.id, role, b))

      case 'record_payment':
        needMoney()
        return ok(await recordPaymentAction(db, user.id, b))
      case 'refund':
        needMoney()
        return ok(await refundOrder(db, user.id, b))

      default:
        throw new HttpError(400, 'Unknown action')
    }
  })
)