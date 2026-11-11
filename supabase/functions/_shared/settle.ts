
import { getAdminClient } from './supabaseAdmin.ts'
import { HttpError } from './http.ts'
import { sendOrderEmail } from './sendOrderNotifications.ts'
import type { OrderEmailData } from './orderEmails.ts'

type PaymentTransaction = {
  reference: string
  amount: number
  status: string
  currency?: string
  paid_at?: string
  transaction_date?: string
}

function getShippingAddress(value: unknown): OrderEmailData['shippingAddress'] {
  const a = (
    value && typeof value === 'object' && !Array.isArray(value)
      ? value
      : {}
  ) as Record<string, unknown>

  return {
    line1: String(
      a.line1 ??
      a.address_line_1 ??
      a.address ??
      ''
    ),
    city: String(a.city ?? ''),
    state: String(a.state ?? ''),
    phone: String(a.phone ?? a.phone_number ?? '')
  }
}

function getCustomerName(value: unknown): string {
  const a = (
    value && typeof value === 'object' && !Array.isArray(value)
      ? value
      : {}
  ) as Record<string, unknown>

  const first = String(a.first_name ?? a.firstname ?? '').trim()
  const last = String(a.last_name ?? a.lastname ?? '').trim()

  return (
    [first, last].filter(Boolean).join(' ') ||
    String(a.full_name ?? a.name ?? 'Customer')
  )
}

function getProductImage(snapshot: unknown): string | null {
  if (!snapshot || typeof snapshot !== 'object' || Array.isArray(snapshot)) {
    return null
  }

  const s = snapshot as Record<string, unknown>

  const image =
    s.image_url ??
    s.image ??
    s.featured_image ??
    s.thumbnail

  return typeof image === 'string' && /^https?:\/\//i.test(image)
    ? image
    : null
}

export async function settle(tx: PaymentTransaction) {
  const db = getAdminClient()

  if (tx.status !== 'success') {
    await db
      .from('payments')
      .update({
        status: 'failed',
        raw_response: tx
      })
      .eq('provider_reference', tx.reference)
      .neq('status', 'paid')

    return {
      paid: false,
      status: tx.status
    }
  }

  // Atomically mark the order as paid.
  const { data: newlyPaid, error } = await db.rpc(
    'mark_order_paid',
    {
      p_reference: tx.reference,
      p_amount: tx.amount,
      p_raw: tx
    }
  )

  if (error) {
    throw new HttpError(409, error.message)
  }

  // Retrieve the order.
  const { data: order, error: orderError } = await db
    .from('orders')
    .select('*')
    .eq('order_number', tx.reference)
    .single()

  if (orderError || !order) {
    throw new HttpError(
      500,
      orderError?.message ?? 'Could not retrieve paid order'
    )
  }

  // This payment was already processed.
  if (newlyPaid !== true) {
    return {
      paid: true,
      status: 'success',
      email: 'already_processed'
    }
  }

  // Retrieve the order items.
  const { data: items, error: itemsError } = await db
    .from('order_items')
    .select('*')
    .eq('order_id', order.id)

  if (itemsError) {
    console.error('[Order Email] Item retrieval failed:', itemsError)

    return {
      paid: true,
      status: 'success',
      email: 'pending_data_error'
    }
  }

  const emailData: OrderEmailData = {
    orderNumber: order.order_number,
    customerName: getCustomerName(order.shipping_address),

    items: (items ?? []).map((item) => ({
      name: item.product_name,
      image: getProductImage(item.product_snapshot),
      size: item.size,
      colour: item.colour,
      qty: item.quantity,
      unitKobo: Number(item.unit_price_kobo),
      lineKobo: Number(item.line_total_kobo)
    })),

    subtotalKobo: Number(order.subtotal_kobo),
    shippingKobo: Number(order.shipping_kobo),
    discountKobo: Number(order.discount_kobo),
    totalKobo: Number(order.total_kobo),

    paymentReference: tx.reference,
    paidAt:
      tx.paid_at ??
      tx.transaction_date ??
      new Date().toISOString(),

    shippingAddress: getShippingAddress(order.shipping_address)
  }

  // Send the Order Placed email.
  let emailStatus = 'sent'

  try {
    const result = await sendOrderEmail(
      order.email,
      'placed',
      emailData
    )

    console.log(
      `[Order Email] Placed email sent for ${order.order_number}`,
      result
    )
  } catch (emailError) {
    emailStatus = 'failed'

    console.error(
      `[Order Email] Failed for ${order.order_number}:`,
      emailError
    )
  }

  return {
    paid: true,
    status: 'success',
    email: emailStatus
  }
}
