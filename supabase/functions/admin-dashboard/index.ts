import { handle, reply, readJson, requireMethod, text, HttpError } from '../_shared/http.ts'
import { requireRole } from '../_shared/supabaseAdmin.ts'

// deno-lint-ignore no-explicit-any
type DB = any
// deno-lint-ignore no-explicit-any
type Row = any
type Obj = Record<string, unknown>

/* ---------- permissions ---------- */
const ALL = ['owner', 'admin', 'catalog_manager', 'order_manager', 'support']
const PERM = {
  overview: ALL,
  catalog: ['owner', 'admin', 'catalog_manager', 'order_manager'],
  sales: ['owner', 'admin', 'order_manager'],
  orders: ['owner', 'admin', 'order_manager', 'support'],
  ordersWrite: ['owner', 'admin', 'order_manager'],
  payments: ['owner', 'admin', 'order_manager'],
  customers: ['owner', 'admin', 'order_manager', 'support'],
  customersWrite: ['owner', 'admin', 'support'],
  requests: ['owner', 'admin', 'support'],
  inbox: ['owner', 'admin', 'support'],
  audit: ['owner', 'admin'],
  settings: ['owner', 'admin'],
  team: ['owner', 'admin'],
  owner: ['owner']
} as const
type Perm = keyof typeof PERM
const can = (role: string, p: Perm) => (PERM[p] as readonly string[]).includes(role)
const need = (role: string, p: Perm) => {
  if (!can(role, p)) throw new HttpError(403, 'Insufficient permissions')
}

/* ---------- constants ---------- */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const ORDER_STATUSES = [
  'pending_payment',
  'paid',
  'processing',
  'ready_to_ship',
  'shipped',
  'delivered',
  'cancelled',
  'refunded'
]
// Statuses that only make sense once payment has been verified by a provider webhook
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
const DELIVERY_STAGES = ['paid', 'processing', 'ready_to_ship', 'shipped', 'delivered']
const ACTIVE_DELIVERY_STAGES = ['paid', 'processing', 'ready_to_ship', 'shipped']
const MESSAGE_STATUSES = ['new', 'in_progress', 'resolved', 'spam']
const LOW_STOCK = 5
const DAY = 86_400_000
const TZ_MS = 3_600_000 // Africa/Lagos = UTC+1, no DST

const ORDER_COLS =
  'id,order_number,email,phone,status,payment_status,currency,subtotal_kobo,shipping_kobo,discount_kobo,total_kobo,tracking_number,shipping_provider,placed_at,updated_at'
const REQUEST_COLS =
  'id,request_number,customer_id,name,email,phone,country,outfit_type,garment_type,needed_by,event_date,quantity,status,quote_kobo,agreed_timeline,created_at,updated_at'

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
  type: string,
  entityId: string | null,
  metadata: Obj = {}
) =>
  db
    .from('audit_logs')
    .insert({ actor_user_id: userId, action, entity_type: type, entity_id: entityId, metadata })
    .then(() => {}, console.error)

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

// "2026-11-09" is read as a Lagos calendar day; full ISO strings pass through
function dateParam(v: string | null, label: string, endOfDay = false) {
  if (!v) return null
  const iso = /^\d{4}-\d{2}-\d{2}$/.test(v)
    ? `${v}${endOfDay ? 'T23:59:59.999' : 'T00:00:00.000'}+01:00`
    : v
  const d = new Date(iso)
  if (isNaN(d.getTime())) throw new HttpError(400, `${label} is invalid`)
  return d.toISOString()
}

function range(q: Row, col: string, sp: URLSearchParams) {
  const f = dateParam(sp.get('from'), 'From date')
  const t = dateParam(sp.get('to'), 'To date', true)
  if (f) q = q.gte(col, f)
  if (t) q = q.lte(col, t)
  return q
}

const dayKey = (iso: string) => new Date(Date.parse(iso) + TZ_MS).toISOString().slice(0, 10)
const startOfLagosDay = (ms: number) =>
  Date.parse(`${dayKey(new Date(ms).toISOString())}T00:00:00.000+01:00`)

const head = (db: DB, table: string, sel = 'id') =>
  db.from(table).select(sel, { count: 'exact', head: true })
async function count(q: Row) {
  const { count, error } = await q
  check(error)
  return (count ?? 0) as number
}

/* ---------- sales ---------- */
async function salesSummary(db: DB, fromIso: string, toIso: string) {
  const { data, error } = await db
    .from('orders')
    .select('total_kobo,placed_at')
    .eq('payment_status', 'paid')
    .not('status', 'in', '(cancelled,refunded)')
    .gte('placed_at', fromIso)
    .lte('placed_at', toIso)
    .limit(10000)
  check(error)

  const byDay = new Map<string, { revenue_kobo: number; orders: number }>()
  let revenue = 0
  for (const o of data || []) {
    const k = dayKey(o.placed_at)
    const d = byDay.get(k) ?? { revenue_kobo: 0, orders: 0 }
    d.revenue_kobo += Number(o.total_kobo)
    d.orders++
    revenue += Number(o.total_kobo)
    byDay.set(k, d)
  }

  const series: { date: string; revenue_kobo: number; orders: number }[] = []
  const endKey = dayKey(toIso)
  for (let t = Date.parse(fromIso), i = 0; i < 400; t += DAY, i++) {
    const k = dayKey(new Date(t).toISOString())
    const d = byDay.get(k)
    series.push({ date: k, revenue_kobo: d?.revenue_kobo ?? 0, orders: d?.orders ?? 0 })
    if (k >= endKey) break
  }
  const orders = (data || []).length
  return {
    series,
    totals: {
      revenue_kobo: revenue,
      orders,
      avg_order_kobo: orders ? Math.round(revenue / orders) : 0
    },
    truncated: orders >= 10000
  }
}

async function topProducts(db: DB, fromIso: string, limit = 5) {
  const { data, error } = await db
    .from('order_items')
    .select(
      'product_id,product_name,quantity,line_total_kobo,orders!inner(payment_status,status,placed_at)'
    )
    .eq('orders.payment_status', 'paid')
    .not('orders.status', 'in', '(cancelled,refunded)')
    .gte('orders.placed_at', fromIso)
    .limit(5000)
  check(error)
  const m = new Map<string, { product_id: string | null; name: string; units: number; revenue_kobo: number }>()
  for (const i of data || []) {
    const key = i.product_id ?? i.product_name
    const e = m.get(key) ?? { product_id: i.product_id, name: i.product_name, units: 0, revenue_kobo: 0 }
    e.units += Number(i.quantity)
    e.revenue_kobo += Number(i.line_total_kobo)
    m.set(key, e)
  }
  return [...m.values()].sort((a, b) => b.revenue_kobo - a.revenue_kobo).slice(0, limit)
}

async function sales(db: DB, sp: URLSearchParams) {
  const now = Date.now()
  const to = dateParam(sp.get('to'), 'To date', true) ?? new Date(now).toISOString()
  const from =
    dateParam(sp.get('from'), 'From date') ??
    new Date(startOfLagosDay(Date.parse(to)) - 29 * DAY).toISOString()
  if (Date.parse(to) - Date.parse(from) > 366 * DAY) throw new HttpError(400, 'Range is too large')
  if (Date.parse(from) > Date.parse(to)) throw new HttpError(400, 'From must be before To')
  const [summary, top] = await Promise.all([salesSummary(db, from, to), topProducts(db, from, 10)])
  return { from, to, ...summary, top_products: top }
}

/* ---------- overview ---------- */
async function overview(db: DB, role: string) {
  const out: Obj = { role, generated_at: new Date().toISOString() }
  const tasks: Promise<unknown>[] = []

  if (can(role, 'orders'))
    tasks.push(
      (async () => {
        const entries = await Promise.all(
          ORDER_STATUSES.map(
            async (s) => [s, await count(head(db, 'orders').eq('status', s))] as const
          )
        )
        const counts = Object.fromEntries(entries) as Record<string, number>
        const { data, error } = await db
          .from('orders')
          .select(`${ORDER_COLS},customers(id,full_name)`)
          .order('placed_at', { ascending: false })
          .limit(8)
        check(error)
        out.orders = {
          by_status: counts,
          awaiting_payment: counts.pending_payment,
          to_fulfil: counts.paid + counts.processing + counts.ready_to_ship,
          in_transit: counts.shipped,
          recent: data || []
        }
      })()
    )

  if (can(role, 'sales'))
    tasks.push(
      (async () => {
        const now = Date.now()
        const from = new Date(startOfLagosDay(now) - 29 * DAY).toISOString()
        const [s, top] = await Promise.all([
          salesSummary(db, from, new Date(now).toISOString()),
          topProducts(db, from)
        ])
        const last7 = s.series.slice(-7)
        out.sales = {
          today: s.series[s.series.length - 1],
          last_7_days: {
            revenue_kobo: last7.reduce((n, d) => n + d.revenue_kobo, 0),
            orders: last7.reduce((n, d) => n + d.orders, 0)
          },
          last_30_days: s.totals,
          series: s.series,
          top_products: top,
          truncated: s.truncated
        }
      })()
    )

  if (can(role, 'payments'))
    tasks.push(
      (async () => {
        out.payments = { pending: await count(head(db, 'payments').eq('status', 'pending')) }
      })()
    )

  if (can(role, 'catalog'))
    tasks.push(
      (async () => {
        const [draft, active, archived, low] = await Promise.all([
          count(head(db, 'products').eq('status', 'draft')),
          count(head(db, 'products').eq('status', 'active')),
          count(head(db, 'products').eq('status', 'archived')),
          count(
            db
              .from('product_variants')
              .select('id,products!inner(status)', { count: 'exact', head: true })
              .eq('is_active', true)
              .neq('products.status', 'archived')
              .lte('stock_quantity', LOW_STOCK)
          )
        ])
        out.catalog = {
          products: { draft, active, archived },
          low_stock_variants: low,
          low_stock_threshold: LOW_STOCK
        }
      })()
    )

  if (can(role, 'customers'))
    tasks.push(
      (async () => {
        out.customers = { total: await count(head(db, 'customers')) }
      })()
    )

  if (can(role, 'requests'))
    tasks.push(
      (async () => {
        const [fresh, recent] = await Promise.all([
          count(head(db, 'custom_requests').eq('status', 'new')),
          db
            .from('custom_requests')
            .select('id,request_number,name,email,outfit_type,status,created_at')
            .order('created_at', { ascending: false })
            .limit(8)
        ])
        check(recent.error)
        out.custom_requests = { new: fresh, recent: recent.data || [] }
      })()
    )

  if (can(role, 'inbox'))
    tasks.push(
      (async () => {
        const [fresh, subs, recent] = await Promise.all([
          count(head(db, 'contact_messages').eq('status', 'new')),
          count(head(db, 'newsletter_subscribers').eq('status', 'subscribed')),
          db
            .from('contact_messages')
            .select('id,name,email,enquiry_type,status,created_at')
            .order('created_at', { ascending: false })
            .limit(5)
        ])
        check(recent.error)
        out.messages = { new: fresh, recent: recent.data || [] }
        out.subscribers = { subscribed: subs }
      })()
    )

  await Promise.all(tasks)
  return out
}

/* ---------- orders ---------- */
async function listOrders(db: DB, sp: URLSearchParams) {
  const { page, size, from, to } = pager(sp)
  let q = db
    .from('orders')
    .select(`${ORDER_COLS},customers(id,full_name),order_items(count)`, { count: 'exact' })
  const status = sp.get('status')
  if (status) {
    if (!ORDER_STATUSES.includes(status)) throw new HttpError(400, 'Invalid status')
    q = q.eq('status', status)
  }
  const ps = sp.get('payment_status')
  if (ps) q = q.eq('payment_status', ps)
  const cid = sp.get('customer_id')
  if (cid) q = q.eq('customer_id', uid(cid))
  const s = search(sp)
  if (s) q = q.or(`order_number.ilike.%${s}%,email.ilike.%${s}%,phone.ilike.%${s}%`)
  q = range(q, 'placed_at', sp)

  const { data, count: total, error } = await q
    .order('placed_at', { ascending: false })
    .range(from, to)
  check(error)
  return {
    total: total ?? 0,
    page,
    limit: size,
    orders: (data || []).map(({ order_items, customers, ...o }: Row) => ({
      ...o,
      customer: customers ?? null,
      item_count: order_items?.[0]?.count ?? 0
    }))
  }
}

async function getOrder(db: DB, id: string) {
  const [o, pay, tl] = await Promise.all([
    db
      .from('orders')
      .select('*, order_items(*), customers(id,full_name,email,phone)')
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
      .limit(50)
  ])
  check(o.error)
  check(pay.error)
  check(tl.error)
  if (!o.data) throw new HttpError(404, 'Order not found')
  const { order_items, customers, ...order } = o.data
  return {
    order: { ...order, customer: customers ?? null, items: order_items || [] },
    payments: pay.data || [],
    timeline: tl.data || [],
    allowed_next_statuses: TRANSITIONS[order.status] ?? []
  }
}

async function restockOrder(db: DB, orderId: string) {
  const { data, error } = await db
    .from('order_items')
    .select('variant_id,quantity')
    .eq('order_id', orderId)
    .not('variant_id', 'is', null)
  check(error)
  for (const i of data || []) {
    const r = await db.rpc('adjust_variant_stock', {
      p_variant: i.variant_id,
      p_delta: Number(i.quantity),
      p_set: null
    })
    check(r.error)
  }
  return (data || []).length
}

async function updateOrder(db: DB, userId: string, b: Obj) {
  const id = uid(b.id)
  const { data: o, error } = await db
    .from('orders')
    .select('id,status,payment_status,tracking_number,shipping_provider')
    .eq('id', id)
    .maybeSingle()
  check(error)
  if (!o) throw new HttpError(404, 'Order not found')

  const patch: Obj = {}
  if ('internal_note' in b) patch.internal_note = text(b.internal_note, 4000) || null
  if ('tracking_number' in b) patch.tracking_number = text(b.tracking_number, 120) || null
  if ('shipping_provider' in b) patch.shipping_provider = text(b.shipping_provider, 120) || null

  const next = b.status !== undefined && b.status !== null ? String(b.status) : null
  const moving = !!next && next !== o.status
  if (moving) {
    if (!ORDER_STATUSES.includes(next!)) throw new HttpError(400, 'Invalid status')
    if (!(TRANSITIONS[o.status] ?? []).includes(next!))
      throw new HttpError(409, `An order that is ${o.status} cannot move to ${next}`)
    // Payment is only ever confirmed by the provider webhook, never from here
    if (PAID_STAGES.includes(next!) && o.payment_status !== 'paid')
      throw new HttpError(409, 'Payment has not been verified for this order yet')
    if (next === 'shipped') {
      const provider = (patch.shipping_provider ?? o.shipping_provider) as string | null
      if (!provider) throw new HttpError(400, 'Shipping provider is required to mark as shipped')
    }
    patch.status = next
  }
  if (!Object.keys(patch).length) throw new HttpError(400, 'Nothing to update')

  check((await db.from('orders').update(patch).eq('id', id)).error)

  // Opt-in: only when the admin explicitly says stock was held for this order
  let restocked = 0
  if (moving && ['cancelled', 'refunded'].includes(next!) && b.restock === true)
    restocked = await restockOrder(db, id)

  await audit(db, userId, 'order.update', 'order', id, {
    from: moving ? o.status : null,
    to: moving ? next : null,
    fields: Object.keys(patch),
    restocked
  })
  return await getOrder(db, id)
}

/* ---------- deliveries ---------- */
async function listDeliveries(db: DB, sp: URLSearchParams) {
  const { page, size, from, to } = pager(sp)
  const stage = sp.get('stage')
  if (stage && !DELIVERY_STAGES.includes(stage)) throw new HttpError(400, 'Invalid stage')

  let q = db
    .from('orders')
    .select(
      `${ORDER_COLS},shipping_address,customer_note,order_items(product_name,size,colour,quantity)`,
      { count: 'exact' }
    )
  q = stage ? q.eq('status', stage) : q.in('status', ACTIVE_DELIVERY_STAGES)
  const provider = text(sp.get('provider'), 120)
  if (provider) q = q.eq('shipping_provider', provider)
  const s = search(sp)
  if (s)
    q = q.or(
      `order_number.ilike.%${s}%,email.ilike.%${s}%,phone.ilike.%${s}%,tracking_number.ilike.%${s}%`
    )
  q = range(q, 'placed_at', sp)

  const [list, stageCounts] = await Promise.all([
    q.order('placed_at', { ascending: true }).range(from, to),
    Promise.all(
      DELIVERY_STAGES.map(
        async (s) => [s, await count(head(db, 'orders').eq('status', s))] as const
      )
    )
  ])
  check(list.error)

  const now = Date.now()
  const deliveries = (list.data || []).map(({ order_items, ...o }: Row) => {
    const ageDays = Math.floor((now - Date.parse(o.updated_at)) / DAY)
    const attention = o.status === 'shipped' ? ageDays > 7 : o.status !== 'delivered' && ageDays > 2
    return { ...o, items: order_items || [], days_in_stage: ageDays, needs_attention: attention }
  })
  return {
    total: list.count ?? 0,
    page,
    limit: size,
    stage_counts: Object.fromEntries(stageCounts),
    deliveries
  }
}

/* ---------- customers ---------- */
type Stats = { order_count: number; total_spent_kobo: number; last_order_at: string | null }
async function customerStats(db: DB, ids: string[]) {
  const m = new Map<string, Stats>()
  if (!ids.length) return m
  const { data, error } = await db
    .from('orders')
    .select('customer_id,total_kobo,payment_status,status,placed_at')
    .in('customer_id', ids)
    .limit(5000)
  check(error)
  for (const o of data || []) {
    const s = m.get(o.customer_id) ?? { order_count: 0, total_spent_kobo: 0, last_order_at: null }
    s.order_count++
    if (o.payment_status === 'paid' && !['cancelled', 'refunded'].includes(o.status))
      s.total_spent_kobo += Number(o.total_kobo)
    if (!s.last_order_at || o.placed_at > s.last_order_at) s.last_order_at = o.placed_at
    m.set(o.customer_id, s)
  }
  return m
}
const NO_STATS: Stats = { order_count: 0, total_spent_kobo: 0, last_order_at: null }

async function listCustomers(db: DB, sp: URLSearchParams) {
  const { page, size, from, to } = pager(sp)
  let q = db
    .from('customers')
    .select('id,full_name,email,phone,auth_user_id,created_at', { count: 'exact' })
  const s = search(sp)
  if (s) q = q.or(`full_name.ilike.%${s}%,email.ilike.%${s}%,phone.ilike.%${s}%`)
  q = range(q, 'created_at', sp)
  const { data, count: total, error } = await q
    .order('created_at', { ascending: false })
    .range(from, to)
  check(error)
  const stats = await customerStats(db, (data || []).map((c: Row) => c.id))
  return {
    total: total ?? 0,
    page,
    limit: size,
    customers: (data || []).map(({ auth_user_id, ...c }: Row) => ({
      ...c,
      has_account: !!auth_user_id,
      ...(stats.get(c.id) ?? NO_STATS)
    }))
  }
}

async function getCustomer(db: DB, id: string) {
  const [c, addr, orders, reqs] = await Promise.all([
    db.from('customers').select('*').eq('id', id).maybeSingle(),
    db
      .from('customer_addresses')
      .select('*')
      .eq('customer_id', id)
      .order('is_default', { ascending: false }),
    db
      .from('orders')
      .select(ORDER_COLS)
      .eq('customer_id', id)
      .order('placed_at', { ascending: false })
      .limit(50),
    db
      .from('custom_requests')
      .select('id,request_number,outfit_type,status,quote_kobo,created_at')
      .eq('customer_id', id)
      .order('created_at', { ascending: false })
      .limit(20)
  ])
  for (const r of [c, addr, orders, reqs]) check(r.error)
  if (!c.data) throw new HttpError(404, 'Customer not found')
  const stats = await customerStats(db, [id])
  return {
    customer: c.data,
    stats: stats.get(id) ?? NO_STATS,
    addresses: addr.data || [],
    orders: orders.data || [],
    custom_requests: reqs.data || []
  }
}

async function updateCustomer(db: DB, userId: string, b: Obj) {
  const id = uid(b.id)
  const patch: Obj = {}
  if ('full_name' in b) {
    const n = text(b.full_name, 160)
    if (!n) throw new HttpError(400, 'Name is required')
    patch.full_name = n
  }
  if ('phone' in b) patch.phone = text(b.phone, 40) || null
  if (!Object.keys(patch).length) throw new HttpError(400, 'Nothing to update')
  const { data, error } = await db
    .from('customers')
    .update(patch)
    .eq('id', id)
    .select()
    .maybeSingle()
  check(error)
  if (!data) throw new HttpError(404, 'Customer not found')
  await audit(db, userId, 'customer.update', 'customer', id, { fields: Object.keys(patch) })
  return { customer: data }
}

/* ---------- payments ---------- */
async function listPayments(db: DB, sp: URLSearchParams) {
  const { page, size, from, to } = pager(sp)
  let q = db
    .from('payments')
    .select(
      'id,order_id,provider,provider_reference,status,amount_kobo,currency,verified_at,created_at,orders(order_number,email,status,total_kobo)',
      { count: 'exact' }
    )
  const status = sp.get('status')
  if (status) q = q.eq('status', status)
  const provider = text(sp.get('provider'), 60)
  if (provider) q = q.eq('provider', provider)
  const oid = sp.get('order_id')
  if (oid) q = q.eq('order_id', uid(oid))
  const s = search(sp)
  if (s) q = q.ilike('provider_reference', `%${s}%`)
  q = range(q, 'created_at', sp)

  // Summary honours the date range only, so the cards stay stable while filtering the table
  const sumQ = range(db.from('payments').select('status,amount_kobo').limit(10000), 'created_at', sp)
  const [list, sum] = await Promise.all([
    q.order('created_at', { ascending: false }).range(from, to),
    sumQ
  ])
  check(list.error)
  check(sum.error)

  const summary: Record<string, { count: number; amount_kobo: number }> = {}
  for (const p of sum.data || []) {
    const e = (summary[p.status] ??= { count: 0, amount_kobo: 0 })
    e.count++
    e.amount_kobo += Number(p.amount_kobo)
  }
  return {
    total: list.count ?? 0,
    page,
    limit: size,
    summary,
    payments: (list.data || []).map(({ orders, ...p }: Row) => ({
      ...p,
      order: orders ?? null,
      amount_matches_order: orders ? Number(p.amount_kobo) === Number(orders.total_kobo) : null
    }))
  }
}

async function getPayment(db: DB, id: string, role: string) {
  const { data, error } = await db
    .from('payments')
    .select('*, orders(id,order_number,email,status,payment_status,total_kobo)')
    .eq('id', id)
    .maybeSingle()
  check(error)
  if (!data) throw new HttpError(404, 'Payment not found')
  const { orders, raw_response, ...p } = data
  return {
    payment: {
      ...p,
      ...(['owner', 'admin'].includes(role) ? { raw_response } : {}),
      order: orders ?? null,
      amount_matches_order: orders ? Number(p.amount_kobo) === Number(orders.total_kobo) : null
    }
  }
}

/* ---------- custom requests ---------- */
async function listRequests(db: DB, sp: URLSearchParams) {
  const { page, size, from, to } = pager(sp)
  let q = db.from('custom_requests').select(REQUEST_COLS, { count: 'exact' })
  const status = sp.get('status')
  if (status) q = q.eq('status', status)
  const s = search(sp)
  if (s) q = q.or(`request_number.ilike.%${s}%,name.ilike.%${s}%,email.ilike.%${s}%`)
  q = range(q, 'created_at', sp)
  const { data, count: total, error } = await q
    .order('created_at', { ascending: false })
    .range(from, to)
  check(error)
  return { total: total ?? 0, page, limit: size, requests: data || [] }
}

async function getRequest(db: DB, id: string) {
  const { data, error } = await db
    .from('custom_requests')
    .select('*, custom_request_files(*)')
    .eq('id', id)
    .maybeSingle()
  check(error)
  if (!data) throw new HttpError(404, 'Request not found')
  const { custom_request_files, ...request } = data
  return { request, files: custom_request_files || [] }
}

async function updateRequest(db: DB, userId: string, b: Obj) {
  const id = uid(b.id)
  const patch: Obj = {}
  if (b.status !== undefined) patch.status = text(b.status, 40)
  if ('quote_kobo' in b) patch.quote_kobo = optInt(b.quote_kobo, 'Quote')
  if ('internal_notes' in b) patch.internal_notes = text(b.internal_notes, 4000) || null
  if ('agreed_timeline' in b) patch.agreed_timeline = text(b.agreed_timeline, 300) || null
  if (!Object.keys(patch).length) throw new HttpError(400, 'Nothing to update')
  const { data, error } = await db
    .from('custom_requests')
    .update(patch)
    .eq('id', id)
    .select(REQUEST_COLS)
    .maybeSingle()
  check(error)
  if (!data) throw new HttpError(404, 'Request not found')
  await audit(db, userId, 'custom_request.update', 'custom_request', id, {
    fields: Object.keys(patch),
    status: patch.status ?? null
  })
  return { request: data }
}

/* ---------- inbox & subscribers ---------- */
async function listMessages(db: DB, sp: URLSearchParams) {
  const { page, size, from, to } = pager(sp)
  let q = db.from('contact_messages').select('*', { count: 'exact' })
  const status = sp.get('status')
  if (status) {
    if (!MESSAGE_STATUSES.includes(status)) throw new HttpError(400, 'Invalid status')
    q = q.eq('status', status)
  }
  const s = search(sp)
  if (s) q = q.or(`name.ilike.%${s}%,email.ilike.%${s}%,message.ilike.%${s}%`)
  q = range(q, 'created_at', sp)
  const { data, count: total, error } = await q
    .order('created_at', { ascending: false })
    .range(from, to)
  check(error)
  return { total: total ?? 0, page, limit: size, messages: data || [] }
}

async function updateMessage(db: DB, userId: string, b: Obj) {
  const id = uid(b.id)
  const patch: Obj = {}
  if (b.status !== undefined) {
    const st = String(b.status)
    if (!MESSAGE_STATUSES.includes(st)) throw new HttpError(400, 'Invalid status')
    patch.status = st
  }
  if ('internal_notes' in b) patch.internal_notes = text(b.internal_notes, 4000) || null
  if (!Object.keys(patch).length) throw new HttpError(400, 'Nothing to update')
  const { data, error } = await db
    .from('contact_messages')
    .update(patch)
    .eq('id', id)
    .select()
    .maybeSingle()
  check(error)
  if (!data) throw new HttpError(404, 'Message not found')
  await audit(db, userId, 'message.update', 'contact_message', id, { fields: Object.keys(patch) })
  return { message: data }
}

async function listSubscribers(db: DB, sp: URLSearchParams) {
  const { page, size, from, to } = pager(sp, 50)
  let q = db.from('newsletter_subscribers').select('*', { count: 'exact' })
  const status = sp.get('status')
  if (status) {
    if (!['subscribed', 'unsubscribed'].includes(status)) throw new HttpError(400, 'Invalid status')
    q = q.eq('status', status)
  }
  const s = search(sp)
  if (s) q = q.ilike('email', `%${s}%`)
  const { data, count: total, error } = await q
    .order('subscribed_at', { ascending: false })
    .range(from, to)
  check(error)
  return { total: total ?? 0, page, limit: size, subscribers: data || [] }
}

async function setSubscriberStatus(db: DB, userId: string, b: Obj) {
  const id = uid(b.id)
  const status = String(b.status)
  if (!['subscribed', 'unsubscribed'].includes(status)) throw new HttpError(400, 'Invalid status')
  const { data, error } = await db
    .from('newsletter_subscribers')
    .update({
      status,
      unsubscribed_at: status === 'unsubscribed' ? new Date().toISOString() : null
    })
    .eq('id', id)
    .select()
    .maybeSingle()
  check(error)
  if (!data) throw new HttpError(404, 'Subscriber not found')
  await audit(db, userId, 'subscriber.status', 'subscriber', id, { status })
  return { subscriber: data }
}

async function deleteSubscriber(db: DB, userId: string, b: Obj) {
  const id = uid(b.id)
  check((await db.from('newsletter_subscribers').delete().eq('id', id)).error)
  await audit(db, userId, 'subscriber.delete', 'subscriber', id)
  return { ok: true }
}

/* ---------- settings ---------- */
async function listSettings(db: DB) {
  const { data, error } = await db.from('shop_settings').select('key,value,updated_by,updated_at')
  check(error)
  return {
    settings: Object.fromEntries((data || []).map((s: Row) => [s.key, s.value])),
    meta: Object.fromEntries(
      (data || []).map((s: Row) => [s.key, { updated_by: s.updated_by, updated_at: s.updated_at }])
    )
  }
}

async function saveSetting(db: DB, userId: string, b: Obj) {
  const key = String(b.key || '')
  if (!/^[a-z0-9_.-]{1,60}$/.test(key)) throw new HttpError(400, 'Invalid setting key')
  if (b.value === undefined) throw new HttpError(400, 'Value is required')
  if (JSON.stringify(b.value).length > 20000) throw new HttpError(400, 'Value is too large')
  const { data, error } = await db
    .from('shop_settings')
    .upsert({ key, value: b.value, updated_by: userId, updated_at: new Date().toISOString() })
    .select()
    .single()
  check(error)
  await audit(db, userId, 'setting.save', 'setting', key)
  return { setting: data }
}

/* ---------- team ---------- */
async function listTeam(db: DB) {
  const { data: roles, error } = await db
    .from('user_roles')
    .select('user_id,role,created_at,updated_at')
    .order('created_at')
  check(error)
  const ids = (roles || []).map((r: Row) => r.user_id)
  const { data: profs } = ids.length
    ? await db.from('profiles').select('id,full_name,phone').in('id', ids)
    : { data: [] }
  const pm = new Map((profs || []).map((p: Row) => [p.id, p]))
  const members = await Promise.all(
    (roles || []).map(async (r: Row) => {
      const res = await db.auth.admin.getUserById(r.user_id).catch(() => null)
      const p = pm.get(r.user_id) as Row | undefined
      return {
        ...r,
        email: res?.data?.user?.email ?? null,
        full_name: p?.full_name ?? null,
        phone: p?.phone ?? null
      }
    })
  )
  return { roles: ALL, members }
}

async function setRole(db: DB, userId: string, b: Obj) {
  const target = uid(b.user_id)
  const role = String(b.role)
  if (!ALL.includes(role)) throw new HttpError(400, 'Invalid role')
  if (target === userId) throw new HttpError(400, 'You cannot change your own role')
  check(
    (
      await db
        .from('user_roles')
        .upsert({ user_id: target, role, updated_at: new Date().toISOString() })
    ).error
  )
  await audit(db, userId, 'team.set_role', 'user', target, { role })
  return { ok: true }
}

async function removeRole(db: DB, userId: string, b: Obj) {
  const target = uid(b.user_id)
  if (target === userId) throw new HttpError(400, 'You cannot remove your own access')
  check((await db.from('user_roles').delete().eq('user_id', target)).error)
  await audit(db, userId, 'team.remove_role', 'user', target)
  return { ok: true }
}

/* ---------- audit ---------- */
async function listAudit(db: DB, sp: URLSearchParams) {
  const { page, size, from, to } = pager(sp, 50)
  let q = db.from('audit_logs').select('*', { count: 'exact' })
  const type = text(sp.get('entity_type'), 60)
  if (type) q = q.eq('entity_type', type)
  const action = text(sp.get('action'), 80)
  if (action) q = q.eq('action', action)
  const eid = text(sp.get('entity_id'), 80)
  if (eid) q = q.eq('entity_id', eid)
  const actor = sp.get('actor')
  if (actor) q = q.eq('actor_user_id', uid(actor))
  q = range(q, 'created_at', sp)
  const { data, count: total, error } = await q
    .order('created_at', { ascending: false })
    .range(from, to)
  check(error)
  return { total: total ?? 0, page, limit: size, logs: data || [] }
}

/* ---------- router ---------- */
Deno.serve(
  handle(async (req, cors) => {
    requireMethod(req, 'GET', 'POST')
    const { user, db, role } = await requireRole(req, ALL)
    const ok = (body: unknown) => reply(cors, body)

    if (req.method === 'GET') {
      const sp = new URL(req.url).searchParams
      switch (sp.get('resource') || 'overview') {
        case 'overview':
          return ok(await overview(db, role))
        case 'sales':
          need(role, 'sales')
          return ok(await sales(db, sp))

        case 'orders':
          need(role, 'orders')
          return ok(await listOrders(db, sp))
        case 'order':
          need(role, 'orders')
          return ok(await getOrder(db, uid(sp.get('id'))))
        case 'deliveries':
          need(role, 'orders')
          return ok(await listDeliveries(db, sp))

        case 'customers':
          need(role, 'customers')
          return ok(await listCustomers(db, sp))
        case 'customer':
          need(role, 'customers')
          return ok(await getCustomer(db, uid(sp.get('id'))))

        case 'payments':
          need(role, 'payments')
          return ok(await listPayments(db, sp))
        case 'payment':
          need(role, 'payments')
          return ok(await getPayment(db, uid(sp.get('id')), role))

        case 'custom_requests':
          need(role, 'requests')
          return ok(await listRequests(db, sp))
        case 'custom_request':
          need(role, 'requests')
          return ok(await getRequest(db, uid(sp.get('id'))))

        case 'messages':
          need(role, 'inbox')
          return ok(await listMessages(db, sp))
        case 'subscribers':
          need(role, 'inbox')
          return ok(await listSubscribers(db, sp))

        case 'settings':
          need(role, 'settings')
          return ok(await listSettings(db))
        case 'team':
          need(role, 'team')
          return ok(await listTeam(db))
        case 'audit':
          need(role, 'audit')
          return ok(await listAudit(db, sp))
        default:
          throw new HttpError(400, 'Unknown resource')
      }
    }

    const b = await readJson(req)
    switch (b.action) {
      case 'update_order':
        need(role, 'ordersWrite')
        return ok(await updateOrder(db, user.id, b))
      case 'update_customer':
        need(role, 'customersWrite')
        return ok(await updateCustomer(db, user.id, b))
      case 'update_request':
        need(role, 'requests')
        return ok(await updateRequest(db, user.id, b))
      case 'update_message':
        need(role, 'inbox')
        return ok(await updateMessage(db, user.id, b))
      case 'set_subscriber_status':
        need(role, 'inbox')
        return ok(await setSubscriberStatus(db, user.id, b))
      case 'delete_subscriber':
        need(role, 'settings')
        return ok(await deleteSubscriber(db, user.id, b))
      case 'save_setting':
        need(role, 'settings')
        return ok(await saveSetting(db, user.id, b))
      case 'set_role':
        need(role, 'owner')
        return ok(await setRole(db, user.id, b))
      case 'remove_role':
        need(role, 'owner')
        return ok(await removeRole(db, user.id, b))
      default:
        throw new HttpError(400, 'Unknown action')
    }
  })
)