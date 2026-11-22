
import {
  handle,
  reply,
  requireMethod,
  HttpError,
} from '../_shared/http.ts'

import { getAdminClient } from '../_shared/supabaseAdmin.ts'

const STATUS_INFO: Record<
  string,
  { label: string; description: string }
> = {
  pending_payment: {
    label: 'Awaiting payment',
    description: 'Your order has been placed and is awaiting payment confirmation.',
  },
  paid: {
    label: 'Payment confirmed',
    description: 'Your payment has been confirmed successfully.',
  },
  processing: {
    label: 'Order processing',
    description: 'Your order is being prepared by our team.',
  },
  ready_to_ship: {
    label: 'Ready for dispatch',
    description: 'Your order has been prepared and is ready for dispatch.',
  },
  shipped: {
    label: 'Shipped',
    description: 'Your order has been dispatched and is on its way.',
  },
  delivered: {
    label: 'Delivered',
    description: 'Your order has been delivered successfully.',
  },
  cancelled: {
    label: 'Cancelled',
    description: 'This order has been cancelled.',
  },
  refunded: {
    label: 'Refunded',
    description: 'A refund has been processed for this order.',
  },
}

function getStatusInfo(status: string) {
  return STATUS_INFO[status] ?? {
    label: status.replaceAll('_', ' '),
    description: 'Your order status has been updated.',
  }
}

function isValidUuid(value: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    value,
  )
}

function buildTimeline(
  order: Record<string, any>,
  events: Record<string, any>[],
) {
  const timeline: {
    status: string
    label: string
    description: string
    at: string | null
  }[] = []

  // The order creation timestamp is the first timeline event.
  timeline.push({
    status: 'placed',
    label: 'Order placed',
    description: 'Your order has been received successfully.',
    at: order.placed_at ?? null,
  })

  const seen = new Set<string>()

  for (const event of events) {
    const status = event.metadata?.to

    if (!status || typeof status !== 'string') continue

    const info = getStatusInfo(status)

    timeline.push({
      status,
      label: info.label,
      description: info.description,
      at: event.created_at ?? null,
    })

    seen.add(status)
  }

  // Ensure the current status is represented, even if no audit event
  // exists for it. Use updated_at only as a fallback.
  const currentStatus = String(order.status)

  if (!seen.has(currentStatus)) {
    const info = getStatusInfo(currentStatus)

    timeline.push({
      status: currentStatus,
      label: info.label,
      description: info.description,
      at: order.updated_at ?? order.placed_at ?? null,
    })
  }

  return timeline
}

export const publicOrderTracking = handle(async (req, cors) => {
  requireMethod(req, 'GET')

  const url = new URL(req.url)
  const token = url.searchParams.get('token')?.trim()

  if (!token || !isValidUuid(token)) {
    throw new HttpError(400, 'A valid tracking token is required.')
  }

  const supabase = getAdminClient()

  // Fetch the order and its items.
  const { data: order, error: orderError } = await supabase
    .from('orders')
    .select(`
      id,
      order_number,
      status,
      payment_status,
      currency,
      placed_at,
      updated_at,
      delivery_method,
      shipped_at,
      delivered_at,
      estimated_delivery_date,
      shipping_provider,
      tracking_number,
      tracking_url,
      tracking_page_url,
      order_items (
        product_name,
        size,
        colour,
        quantity
      )
    `)
    .eq('tracking_token', token)
    .maybeSingle()

  if (orderError) {
    console.error('[Public Order Tracking] Order lookup failed:', orderError)
    throw new HttpError(500, 'Unable to retrieve order tracking information.')
  }

  if (!order) {
    throw new HttpError(404, 'We could not find an order with this tracking link.')
  }

  // Fetch the order's public status history.
  const { data: events, error: eventsError } = await supabase
    .from('audit_logs')
    .select('metadata, created_at')
    .eq('entity_type', 'order')
    .eq('entity_id', order.id)
    .eq('action', 'order.status')
    .order('created_at', { ascending: true })

  if (eventsError) {
    console.error('[Public Order Tracking] Status history lookup failed:', eventsError)
    throw new HttpError(500, 'Unable to retrieve order status history.')
  }

  const status = String(order.status)
  const statusInfo = getStatusInfo(status)

  const items = (order.order_items ?? []).map((item: Record<string, any>) => ({
    name: item.product_name ?? 'AnniePetars item',
    size: item.size ?? null,
    colour: item.colour ?? null,
    quantity: Number(item.quantity ?? 1),
  }))

  const result = {
    order_number: order.order_number,
    status,
    status_label: statusInfo.label,
    payment_status: order.payment_status,
    currency: String(order.currency).trim(),
    delivery_method: order.delivery_method,

    placed_at: order.placed_at ?? null,

    // There is no paid_at column in the orders table.
    paid_at: null,

    shipped_at: order.shipped_at ?? null,
    delivered_at: order.delivered_at ?? null,
    estimated_delivery_date: order.estimated_delivery_date ?? null,

    shipping: {
      provider: order.shipping_provider ?? null,
      tracking_number: order.tracking_number ?? null,
      tracking_url: order.tracking_url ?? null,
    },

    items,

    timeline: buildTimeline(order, events ?? []),
  }

  cors['Cache-Control'] = 'no-store, max-age=0'

  return reply(cors, result)
})
