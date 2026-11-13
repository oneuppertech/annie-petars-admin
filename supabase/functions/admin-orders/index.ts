import { handle, reply, readJson, text, HttpError } from '../_shared/http.ts'
import { requireRole } from '../_shared/supabaseAdmin.ts'
import { sendOrderEmail } from '../_shared/sendOrderNotifications.ts'
import type { OrderEmailData, OrderEvent } from '../_shared/orderEmails.ts'
const statuses = [
  'pending_payment',
  'paid',
  'processing',
  'ready_to_ship',
  'shipped',
  'delivered',
  'cancelled',
  'refunded'
]

const NEXT: Record<string, string[]> = {
  pending_payment: ['cancelled'],
  paid: ['processing', 'cancelled', 'refunded'],
  processing: ['ready_to_ship', 'shipped', 'cancelled', 'refunded'],
  ready_to_ship: ['shipped', 'cancelled', 'refunded'],
  shipped: ['delivered', 'refunded'],
  delivered: ['refunded'],
  cancelled: [],
  refunded: []
}

const CLOSED = ['cancelled', 'refunded']
const REFUNDED_PAYMENT_STATUS = 'refunded' // remove the payment_status update in `refund` if your enum has no such value
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
const SORTS = ['placed_at', 'total_kobo', 'updated_at', 'order_number']

// deno-lint-ignore no-explicit-any
type Any = any

/* ---------- helpers ---------- */

/** Pickup orders skip `shipped`: ready_to_ship goes straight to delivered. */
function nextFor(o: Any): string[] {
  const base = NEXT[o.status] ?? []
  if (o.delivery_method !== 'pickup') return base
  const rest = base.filter((s) => s !== 'shipped')
  return o.status === 'ready_to_ship' ? ['delivered', ...rest] : rest
}

const stockHeld = (o: Any) => o.payment_status === 'paid' && !CLOSED.includes(o.status)

/** Strip characters that would break PostgREST's or() filter syntax. */
const safeSearch = (s: string, max: number) =>
  s
    .replace(/[,()%*\\]/g, ' ')
    .trim()
    .slice(0, max)

async function loadDetail(db: Any, id: string) {
  const { data: order, error } = await db
    .from('orders')
    .select('*, items:order_items(*), customer:customers(id, full_name, email, phone, created_at)')
    .eq('id', id)
    .maybeSingle()
  if (error) throw new HttpError(500, 'Could not load order', error.message)
  if (!order) throw new HttpError(404, 'Order not found')

  const variantIds = (order.items ?? []).map((i: Any) => i.variant_id).filter(Boolean)
  const [{ data: payments }, { data: logs }, { data: variants }] = await Promise.all([
    db.from('payments').select('*').eq('order_id', id).order('created_at', { ascending: false }),
    db
      .from('audit_logs')
      .select('*')
      .eq('entity_type', 'order')
      .eq('entity_id', id)
      .order('created_at', { ascending: false }),
    variantIds.length
      ? db.from('product_variants').select('id, stock_quantity, is_active').in('id', variantIds)
      : Promise.resolve({ data: [] })
  ])

  const vmap = new Map((variants ?? []).map((v: Any) => [v.id, v]))
  const items = (order.items ?? []).map((i: Any) => ({
    ...i,
    current_stock: vmap.get(i.variant_id)?.stock_quantity ?? null,
    variant_active: vmap.get(i.variant_id)?.is_active ?? null
  }))

  // Checkout stores name/line1/state/country; the page reads schema-style keys
  const a: Any = order.shipping_address ?? {}
  const shipping_address = {
    recipient_name: a.recipient_name ?? a.name,
    phone: a.phone,
    address_line1: a.address_line1 ?? a.line1,
    address_line2: a.address_line2 ?? a.line2,
    city: a.city,
    state_region: a.state_region ?? a.state,
    postal_code: a.postal_code,
    country_code: a.country_code ?? a.country
  }

  let customer_order_count = 0
  if (order.customer_id) {
    const { count } = await db
      .from('orders')
      .select('id', { count: 'exact', head: true })
      .eq('customer_id', order.customer_id)
    customer_order_count = count ?? 0
  }

  const paid_kobo = (payments ?? [])
    .filter((p: Any) => p.status === 'paid')
    .reduce((s: number, p: Any) => s + Number(p.amount_kobo), 0)
  const itemsTotal = items.reduce((s: number, i: Any) => s + Number(i.line_total_kobo), 0)

  return {
    order: { ...order, items, shipping_address, customer_order_count },
    payments: payments ?? [],
    timeline: logs ?? [],
    allowed_next_statuses: nextFor(order),
    flags: {
      stock_held: stockHeld(order),
      editable_items: false, // flip to order.status === 'pending_payment' once edit_items exists
      editable_address: ['pending_payment', 'paid', 'processing'].includes(order.status)
    },
    reconciliation: {
      items_total_kobo: itemsTotal,
      subtotal_matches_items: itemsTotal === Number(order.subtotal_kobo),
      total_matches_parts:
        Number(order.total_kobo) ===
        Number(order.subtotal_kobo) + Number(order.shipping_kobo) - Number(order.discount_kobo),
      paid_kobo,
      payment_matches_total: paid_kobo === Number(order.total_kobo)
    }
  }
}

async function getOrderRow(db: Any, id: string) {
  const { data, error } = await db
    .from('orders')
    .select('*, items:order_items(*)')
    .eq('id', id)
    .maybeSingle()
  if (error) throw new HttpError(500, 'Could not load order', error.message)
  if (!data) throw new HttpError(404, 'Order not found')
  return data
}

async function updateOrder(db: Any, id: string, patch: Record<string, unknown>) {
  const { error } = await db.from('orders').update(patch).eq('id', id)
  if (error) throw new HttpError(400, 'Could not update order', error.message)
}

async function log(
  db: Any,
  userId: string,
  id: string,
  action: string,
  metadata: Record<string, unknown> = {}
) {
  await db
    .from('audit_logs')
    .insert({ actor_user_id: userId, action, entity_type: 'order', entity_id: id, metadata })
}

async function restock(db: Any, items: Any[]) {
  // Read-then-write is fine at your volume; move to an RPC (stock_quantity = stock_quantity + n) if you need it atomic
  for (const i of items) {
    if (!i.variant_id) continue
    const { data: v } = await db
      .from('product_variants')
      .select('stock_quantity')
      .eq('id', i.variant_id)
      .maybeSingle()
    if (!v) continue
    await db
      .from('product_variants')
      .update({ stock_quantity: Number(v.stock_quantity) + Number(i.quantity) })
      .eq('id', i.variant_id)
  }
}

/** Optional delivery fields, applied only when the caller sent them. */
function deliveryFields(b: Any): Record<string, unknown> {
  const p: Record<string, unknown> = {}
  if ('estimated_delivery_date' in b)
    p.estimated_delivery_date = text(b.estimated_delivery_date, 10) || null
  if ('tracking_url' in b) p.tracking_url = text(b.tracking_url, 500) || null
  return p
}
function emailEventForStatus(status: string): OrderEvent | null {
  switch (status) {
    case 'shipped':
      return 'shipped'
    case 'delivered':
      return 'delivered'
    case 'cancelled':
      return 'cancelled'
    default:
      return null
  }
}

function buildOrderEmailData(order: Any, reason?: string): OrderEmailData {
  const address = order.shipping_address ?? {}

  const customerName =
    address.recipient_name ?? address.name ?? order.customer?.full_name ?? 'Customer'

  return {
    orderNumber: order.order_number,
    customerName,

    items: (order.items ?? []).map((item: Any) => {
      const snapshot = item.product_snapshot ?? {}
      const image =
        snapshot.image_url ?? snapshot.image ?? snapshot.featured_image ?? snapshot.thumbnail

      return {
        name: item.product_name ?? 'Product',
        image: typeof image === 'string' && /^https?:\/\//i.test(image) ? image : null,
        size: item.size ?? null,
        colour: item.colour ?? null,
        qty: Number(item.quantity ?? 0),
        unitKobo: Number(item.unit_price_kobo ?? 0),
        lineKobo: Number(item.line_total_kobo ?? 0)
      }
    }),

    subtotalKobo: Number(order.subtotal_kobo ?? 0),
    shippingKobo: Number(order.shipping_kobo ?? 0),
    discountKobo: Number(order.discount_kobo ?? 0),
    totalKobo: Number(order.total_kobo ?? 0),

    paidAt: order.paid_at ?? null,

    shippingAddress: {
      line1: address.address_line1 ?? address.line1 ?? '',
      city: address.city ?? '',
      state: address.state_region ?? address.state ?? '',
      phone: address.phone ?? ''
    },

    trackingNumber: order.tracking_number ?? null,
    shippingProvider: order.shipping_provider ?? null,
    trackUrl: order.tracking_url ?? null,
    reason: reason || undefined
  }
}

async function notifyOrderStatus(order: Any, status: string, reason?: string) {
  const event = emailEventForStatus(status)

  // No email is configured for this status.
  if (!event) return

  if (!order.email?.trim()) {
    console.warn('[Order Email] Skipped: customer email is missing', {
      orderNumber: order.order_number,
      status
    })
    return
  }

  try {
    const data = buildOrderEmailData(order, reason)

    const result = await sendOrderEmail(order.email, event, data)

    console.log('[Order Email] Status notification sent', {
      orderNumber: order.order_number,
      status,
      event,
      recipient: order.email,
      messageId: result.id
    })
  } catch (error) {
    // Never undo a successful order update because an email failed.
    console.error('[Order Email] Status notification failed', {
      orderNumber: order.order_number,
      status,
      error: error instanceof Error ? error.message : error
    })
  }
}
/* ---------- handler ---------- */

Deno.serve(
  handle(async (req, cors) => {
    const { db, user } = await requireRole(req, ['owner', 'admin', 'order_manager'])

    /* ===== GET ===== */
    if (req.method === 'GET') {
      const u = new URL(req.url)
      const param = (k: string) => u.searchParams.get(k)

      if (param('resource') === 'order') {
        const id = text(param('id'), 80)
        if (!id) throw new HttpError(400, 'Order id is required')
        return reply(cors, await loadDetail(db, id))
      }

      // ----- list -----
      const page = Math.max(Number(param('page') || 1) || 1, 1)
      const limit = Math.min(Math.max(Number(param('limit') || 20) || 20, 1), 100)
      const sort = SORTS.includes(param('sort') ?? '') ? param('sort')! : 'placed_at'
      const asc = param('dir') === 'asc'

      let q = db
        .from('orders')
        .select('*, items:order_items(*), customer:customers(id, full_name)', { count: 'exact' })
        .order(sort, { ascending: asc })
        .range((page - 1) * limit, page * limit - 1)

      const status = param('status')
      if (status) {
        const list = status
          .split(',')
          .map((s) => s.trim())
          .filter((s) => statuses.includes(s))
        if (list.length) q = list.length > 1 ? q.in('status', list) : q.eq('status', list[0])
      }

      const search = param('q')
      if (search) {
        const s = safeSearch(search, 120)
        if (s) q = q.or(`order_number.ilike.%${s}%,email.ilike.%${s}%`)
      }

      const pay = param('payment_status')
      if (pay) q = q.eq('payment_status', pay)

      const method = param('delivery_method')
      if (method === 'delivery' || method === 'pickup') q = q.eq('delivery_method', method)

      const provider = param('provider')
      if (provider) q = q.ilike('shipping_provider', `%${safeSearch(provider, 60)}%`)

      const customerId = param('customer_id')
      if (customerId) q = q.eq('customer_id', customerId)

      if (param('guest') === 'true') q = q.is('customer_id', null)
      if (param('has_tracking') === 'true') q = q.not('tracking_number', 'is', null)

      const minTotal = param('min_total')
      if (minTotal && !isNaN(Number(minTotal))) q = q.gte('total_kobo', Number(minTotal))
      const maxTotal = param('max_total')
      if (maxTotal && !isNaN(Number(maxTotal))) q = q.lte('total_kobo', Number(maxTotal))

      const from = param('from')
      if (from) q = q.gte('placed_at', from)
      const to = param('to')
      if (to) q = q.lte('placed_at', to.length === 10 ? `${to}T23:59:59.999Z` : to)

      const { data, count, error } = await q
      if (error) throw new HttpError(500, 'Could not load orders', error.message)

      return reply(cors, {
        orders: (data ?? []).map((o: Any) => ({ ...o, allowed_next_statuses: nextFor(o) })),
        total: count ?? 0,
        page,
        limit
      })
    }

    /* ===== POST: { action, id, ... } ===== */
    if (req.method === 'POST') {
      const b = await readJson(req)
      const action = text(b.action, 40)

      /* ----- bulk (no single id) ----- */
      if (action === 'bulk_status') {
        const ids: string[] = Array.isArray(b.ids)
          ? b.ids
              .slice(0, 50)
              .map((x: unknown) => text(x, 80))
              .filter(Boolean)
          : []
        const status = text(b.status, 40)
        const provider = text(b.shipping_provider, 120)
        if (!ids.length) throw new HttpError(400, 'Select at least one order')
        if (!statuses.includes(status)) throw new HttpError(400, 'Invalid status')
        if (status === 'shipped' && !provider)
          throw new HttpError(400, 'Shipping provider is required')

        const results: { id: string; ok: boolean; error?: string }[] = []

        for (const oid of ids) {
          try {
            const o = await getOrderRow(db, oid)
            if (!nextFor(o).includes(status))
              throw new Error(`Cannot move from ${o.status} to ${status}`)

            const patch: Record<string, unknown> = { status }
            const now = new Date().toISOString()
            if (status === 'shipped') {
              patch.shipped_at = now
              patch.shipping_provider = provider
            }
            if (status === 'delivered') {
              patch.delivered_at = now
              if (!o.shipped_at && o.delivery_method !== 'pickup') patch.shipped_at = now
            }

            const doRestock = CLOSED.includes(status) && stockHeld(o) && b.restock !== false
            if (doRestock) await restock(db, o.items ?? [])
            await updateOrder(db, oid, patch)

            await log(db, user.id, oid, 'order.status', {
              from: o.status,
              to: status,
              bulk: true,
              note: text(b.note, 500) || undefined,
              restocked: doRestock
            })

            await notifyOrderStatus({ ...o, ...patch }, status, text(b.note, 500))

            results.push({ id: oid, ok: true })
          } catch (e) {
            results.push({ id: oid, ok: false, error: (e as Error).message })
          }
        }

        const failed = results.filter((r) => !r.ok).length
        return reply(cors, { ok: failed === 0, updated: results.length - failed, failed, results })
      }

      /* ----- single order actions ----- */
      const id = text(b.id, 80)
      if (!id) throw new HttpError(400, 'Order id is required')

      const order = await getOrderRow(db, id)

      switch (action) {
        case 'update_status': {
          const status = text(b.status, 40)
          if (!nextFor(order).includes(status))
            throw new HttpError(400, `Cannot move an order from ${order.status} to ${status}`)

          const provider = text(b.shipping_provider, 120)
          if (status === 'shipped' && !provider)
            throw new HttpError(400, 'Shipping provider is required')

          const now = new Date().toISOString()
          const patch: Record<string, unknown> = { status, ...deliveryFields(b) }
          if ('shipping_provider' in b) patch.shipping_provider = provider || null
          if ('tracking_number' in b) patch.tracking_number = text(b.tracking_number, 120) || null
          if (status === 'shipped') patch.shipped_at = now
          if (status === 'delivered') {
            patch.delivered_at = now
            if (!order.shipped_at && order.delivery_method !== 'pickup') patch.shipped_at = now
          }

          const doRestock = CLOSED.includes(status) && stockHeld(order) && b.restock !== false
          if (doRestock) await restock(db, order.items ?? [])
          await updateOrder(db, id, patch)
          await log(db, user.id, id, 'order.status', {
            from: order.status,
            to: status,
            note: text(b.note, 500) || undefined,
            restocked: doRestock
          })

          await notifyOrderStatus({ ...order, ...patch }, status, text(b.note, 500))
          break
        }

        case 'record_payment': {
          await requireRole(req, ['owner', 'admin'])

          if (order.payment_status === 'paid') {
            throw new HttpError(400, 'This order is already paid')
          }

          const reference = text(b.reference, 120)
          if (!reference) {
            throw new HttpError(400, 'Payment reference is required')
          }

          const type = text(b.type, 30) || 'other'
          const now = new Date().toISOString()

          const { error } = await db.from('payments').insert({
            order_id: id,
            provider: `manual_${type}`,
            provider_reference: reference,
            status: 'paid',
            amount_kobo: order.total_kobo,
            currency: order.currency,
            verified_at: now
          })

          if (error) {
            throw new HttpError(400, 'Could not record payment', error.message)
          }

          const paymentPatch: Record<string, unknown> = {
            payment_status: 'paid',
            paid_at: now
          }

          if (order.status === 'pending_payment') {
            paymentPatch.status = 'paid'
          }

          await updateOrder(db, id, paymentPatch)

          await log(db, user.id, id, 'order.payment_recorded', {
            reference,
            amount_kobo: order.total_kobo,
            payment_type: type
          })

          break
        }

        case 'refund': {
          await requireRole(req, ['owner', 'admin'])
          if (order.payment_status !== 'paid')
            throw new HttpError(400, 'Only paid orders can be refunded')
          const reason = text(b.reason, 500)
          if (!reason) throw new HttpError(400, 'A reason is required')

          const total = Number(order.total_kobo)
          const amount = b.amount_kobo == null ? total : Math.round(Number(b.amount_kobo))
          if (!Number.isFinite(amount) || amount <= 0 || amount > total)
            throw new HttpError(400, 'Invalid refund amount')

          const full = amount === total
          if (full) {
            if (!nextFor(order).includes('refunded'))
              throw new HttpError(400, `Cannot refund an order that is ${order.status}`)
            const doRestock = stockHeld(order) && b.restock !== false
            if (doRestock) await restock(db, order.items ?? [])
            await updateOrder(db, id, {
              status: 'refunded',
              payment_status: REFUNDED_PAYMENT_STATUS
            })
          }
          await log(db, user.id, id, full ? 'order.refunded' : 'order.partial_refund', {
            amount_kobo: amount,
            reason,
            reference: text(b.reference, 120) || undefined
          })
          break
        }

        case 'update_address': {
          if (!['pending_payment', 'paid', 'processing'].includes(order.status))
            throw new HttpError(400, 'Address can no longer be edited')
          const incoming: Any = b.shipping_address ?? {}
          const next: Record<string, unknown> = { ...(order.shipping_address ?? {}) }
          for (const k of ADDR_KEYS) if (k in incoming) next[k] = text(incoming[k], 200)
          if (!(next.address_line1 ?? next.line1) || !next.city)
            throw new HttpError(400, 'Address line 1 and city are required')
          await updateOrder(db, id, { shipping_address: next })
          await log(db, user.id, id, 'order.address_updated')
          break
        }

        case 'update_shipping': {
          await updateOrder(db, id, {
            shipping_provider: text(b.shipping_provider, 120) || null,
            tracking_number: text(b.tracking_number, 120) || null,
            ...deliveryFields(b)
          })
          await log(db, user.id, id, 'order.shipping_updated', {
            provider: text(b.shipping_provider, 120),
            tracking: text(b.tracking_number, 120)
          })
          break
        }

        case 'update_contact': {
          const email = text(b.email, 200)
          if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))
            throw new HttpError(400, 'Valid email is required')
          await updateOrder(db, id, { email, phone: text(b.phone, 40) || null })
          await log(db, user.id, id, 'order.contact_updated')
          break
        }

        case 'update_notes': {
          await updateOrder(db, id, {
            internal_note: text(b.internal_note, 4000) || null,
            customer_note: text(b.customer_note, 4000) || null
          })
          await log(db, user.id, id, 'order.notes_updated')
          break
        }

        case 'add_note': {
          const note = text(b.note, 1000)
          if (!note) throw new HttpError(400, 'Note is required')
          await log(db, user.id, id, 'order.note', { note })
          break
        }

        default:
          throw new HttpError(400, `Unknown action: ${action}`)
      }

      return reply(cors, await loadDetail(db, id))
    }

    /* ===== PATCH (legacy, unchanged) ===== */
    if (req.method === 'PATCH') {
      const b = await readJson(req),
        id = text(b.id, 80),
        status = text(b.status, 40)
      if (!id || !statuses.includes(status))
        throw new HttpError(400, 'Valid order id and status are required')
      const patch: Record<string, unknown> = { status }
      if ('internal_note' in b) patch.internal_note = text(b.internal_note, 4000)
      if ('tracking_number' in b) patch.tracking_number = text(b.tracking_number, 120)
      if ('shipping_provider' in b) patch.shipping_provider = text(b.shipping_provider, 120)
      // Deliberately do not let this endpoint set payment_status=paid; use verified provider webhooks.
      const { data, error } = await db.from('orders').update(patch).eq('id', id).select().single()
      if (error) throw new HttpError(400, 'Could not update order', error.message)
      await db.from('audit_logs').insert({
        actor_user_id: user.id,
        action: 'order.update',
        entity_type: 'order',
        entity_id: id,
        metadata: { status }
      })
      return reply(cors, { data })
    }

    throw new HttpError(405, 'Method not allowed')
  })
)
