
import { handle, reply, requireMethod, HttpError } from '../_shared/http.ts'
import { getAdminClient } from '../_shared/supabaseAdmin.ts'

// deno-lint-ignore no-explicit-any
type Any = any

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

const PUBLIC_STATUSES = new Set([
  'pending_payment',
  'paid',
  'processing',
  'ready_to_ship',
  'shipped',
  'delivered',
  'cancelled',
  'refunded'
])

function statusLabel(status: string): string {
  const labels: Record<string, string> = {
    pending_payment: 'Awaiting payment',
    paid: 'Payment confirmed',
    processing: 'Order processing',
    ready_to_ship: 'Ready for dispatch',
    shipped: 'On the way',
    delivered: 'Delivered',
    cancelled: 'Cancelled',
    refunded: 'Refunded'
  }

  return labels[status] ?? 'Order update'
}

function safeDate(value: unknown): string | null {
  if (!value) return null

  const date = new Date(String(value))
  return Number.isNaN(date.getTime()) ? null : date.toISOString()
}

Deno.serve(
  handle(async (req, cors) => {
    requireMethod(req, 'GET')

    const url = new URL(req.url)
    const token = (url.searchParams.get('token') ?? '').trim()

    if (!UUID_RE.test(token)) {
      throw new HttpError(404, 'Order not found')
    }

    const db = getAdminClient()

    // Only retrieve fields intended for the public tracking page.
    const { data: order, error: orderError } = await db
      .from('orders')
      .select(`
        id,
        order_number,
        tracking_token,
        status,
        payment_status,
        currency,
        delivery_method,
        placed_at,
        paid_at,
        shipped_at,
        delivered_at,
        estimated_delivery_date,
        shipping_provider,
        tracking_number,
        tracking_url,
        items:order_items(
          product_name,
          size,
          colour,
          quantity
        )
      `)
      .eq('tracking_token', token)
      .maybeSingle()

    if (orderError) {
      console.error('[Public Order Tracking] Order lookup failed', orderError)
      throw new HttpError(500, 'Unable to retrieve order tracking')
    }

    // Use the same response for unknown and invalid tokens.
    if (!order) {
      throw new HttpError(404, 'Order not found')
    }

    // Fetch only status-change events. Never return raw audit metadata.
    const { data: logs, error: logsError } = await db
      .from('audit_logs')
      .select('metadata, created_at')
      .eq('entity_type', 'order')
      .eq('entity_id', order.id)
      .eq('action', 'order.status')
      .order('created_at', { ascending: true })

    if (logsError) {
      console.error('[Public Order Tracking] Timeline lookup failed', logsError)
      throw new HttpError(500, 'Unable to retrieve order timeline')
    }

    const timeline: Any[] = []

    const placedAt = safeDate(order.placed_at)

    if (placedAt) {
      timeline.push({
        status: 'placed',
        label: 'Order placed',
        description: 'Your order has been received.',
        at: placedAt
      })
    }

    if (order.paid_at) {
      timeline.push({
        status: 'paid',
        label: statusLabel('paid'),
        description: 'Your payment has been confirmed.',
        at: safeDate(order.paid_at)
      })
    }

    for (const log of logs ?? []) {
      const metadata = log.metadata ?? {}
      const nextStatus = String(metadata.to ?? '')

      if (!PUBLIC_STATUSES.has(nextStatus)) continue

      // Payment confirmation is already represented by paid_at.
      if (nextStatus === 'paid' && order.paid_at) continue

      timeline.push({
        status: nextStatus,
        label: statusLabel(nextStatus),
        description: statusDescription(nextStatus),
        at: safeDate(log.created_at)
      })
    }

    // Include the current state if it has no corresponding audit event.
    const hasCurrentStatus = timeline.some(
      (entry) => entry.status === order.status
    )

    if (
      !hasCurrentStatus &&
      PUBLIC_STATUSES.has(order.status) &&
      order.status !== 'pending_payment'
    ) {
      const currentTimestamp =
        order.delivered_at ??
        order.shipped_at ??
        order.paid_at ??
        order.placed_at

      timeline.push({
        status: order.status,
        label: statusLabel(order.status),
        description: statusDescription(order.status),
        at: safeDate(currentTimestamp)
      })
    }

    const currentStatus = PUBLIC_STATUSES.has(order.status)
      ? order.status
      : 'processing'

    // Never expose the internal order UUID or the tracking token itself.
    const result = {
      order_number: order.order_number,
      status: currentStatus,
      status_label: statusLabel(currentStatus),
      payment_status: order.payment_status,
      currency: order.currency,
      delivery_method: order.delivery_method,
      placed_at: safeDate(order.placed_at),
      paid_at: safeDate(order.paid_at),
      shipped_at: safeDate(order.shipped_at),
      delivered_at: safeDate(order.delivered_at),
      estimated_delivery_date: order.estimated_delivery_date,
      shipping: {
        provider: order.shipping_provider ?? null,
        tracking_number: order.tracking_number ?? null,
        tracking_url: validHttpUrl(order.tracking_url)
      },
      items: (order.items ?? []).map((item: Any) => ({
        name: item.product_name ?? 'Product',
        size: item.size ?? null,
        colour: item.colour ?? null,
        quantity: Number(item.quantity ?? 0)
      })),
      timeline
    }

    // Avoid caching potentially sensitive order information.
    cors['Cache-Control'] = 'no-store, max-age=0'

    return reply(cors, result)
  })
)

function statusDescription(status: string): string {
  const descriptions: Record<string, string> = {
    pending_payment: 'Your order is awaiting payment.',
    paid: 'Your payment has been confirmed.',
    processing: 'Our team is preparing your order.',
    ready_to_ship: 'Your order is ready for dispatch.',
    shipped: 'Your order has been dispatched.',
    delivered: 'Your order has been delivered.',
    cancelled: 'This order has been cancelled.',
    refunded: 'A refund has been recorded for this order.'
  }

  return descriptions[status] ?? 'Your order has been updated.'
}

function validHttpUrl(value: unknown): string | null {
  if (typeof value !== 'string' || !value.trim()) return null

  try {
    const url = new URL(value)
    return ['http:', 'https:'].includes(url.protocol) ? url.toString() : null
  } catch {
    return null
  }
}
