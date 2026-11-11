// _shared/orderNotify.ts
// One call per event. Never throws, so it can't break settlement or admin updates.
//
//   await notifyOrder('placed',    { reference: tx.reference })
//   await notifyOrder('shipped',   { orderId })
//   await notifyOrder('delivered', { orderId })
//   await notifyOrder('cancelled', { orderId }, { reason: 'Item out of stock' })
//   await notifyOrder('returned',  { orderId })

import { getAdminClient } from './supabaseAdmin.ts'
import { orderTemplateVars, orderSubject, orderSms, type OrderEvent, type OrderEmailData } from './orderEmails.ts'
import { sendSms, sendTemplateEmail } from './termii.ts'

type Key = { orderId?: string; reference?: string }

// product_images.image_url may be a full URL or a storage path
function publicUrl(v?: string | null) {
  if (!v) return null
  if (/^https?:\/\//i.test(v)) return v
  const bucket = Deno.env.get('PRODUCT_IMAGE_BUCKET') || 'product-media'
  return `${Deno.env.get('SUPABASE_URL')}/storage/v1/object/public/${bucket}/${v.replace(/^\//, '')}`
}

export async function notifyOrder(
  event: OrderEvent,
  key: Key,
  extra: { reason?: string; trackUrl?: string } = {}
) {
  try {
    const db = getAdminClient()
    const col = key.orderId ? 'id' : 'order_number'
    const val = key.orderId ?? key.reference
    if (!val) return

    const { data: o, error } = await db
      .from('orders')
      .select(
        `id, order_number, email, phone, subtotal_kobo, shipping_kobo, discount_kobo, total_kobo,
         shipping_address, tracking_number, shipping_provider,
         order_items ( product_id, product_name, size, colour, quantity, unit_price_kobo, line_total_kobo )`
      )
      .eq(col, val)
      .single()
    if (error || !o) return console.error('notifyOrder: order not found', error)

    // Send each event once (settle can run from both the verify call and the webhook)
    const action = `notify.${event}`
    const { data: seen } = await db
      .from('audit_logs')
      .select('id')
      .eq('action', action)
      .eq('entity_type', 'order')
      .eq('entity_id', o.id)
      .limit(1)
    if (seen?.length) return

    // Primary image per product
    const ids = [...new Set((o.order_items ?? []).map((i: any) => i.product_id).filter(Boolean))]
    const imgByProduct = new Map<string, string>()
    if (ids.length) {
      const { data: imgs } = await db
        .from('product_images')
        .select('product_id, image_url, is_primary, sort_order')
        .in('product_id', ids)
        .eq('media_type', 'image')
        .order('is_primary', { ascending: false })
        .order('sort_order', { ascending: true })
      for (const im of imgs ?? []) {
        if (!imgByProduct.has(im.product_id)) imgByProduct.set(im.product_id, publicUrl(im.image_url)!)
      }
    }

    const { data: pay } = await db
      .from('payments')
      .select('provider_reference, verified_at')
      .eq('order_id', o.id)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle()

    const ship = (o.shipping_address ?? {}) as Record<string, any>
    const data: OrderEmailData = {
      orderNumber: o.order_number,
      customerName: ship.name || '',
      items: (o.order_items ?? []).map((i: any) => ({
        name: i.product_name,
        image: imgByProduct.get(i.product_id) ?? null,
        size: i.size,
        colour: i.colour,
        qty: i.quantity,
        unitKobo: Number(i.unit_price_kobo),
        lineKobo: Number(i.line_total_kobo)
      })),
      subtotalKobo: Number(o.subtotal_kobo),
      shippingKobo: Number(o.shipping_kobo),
      discountKobo: Number(o.discount_kobo),
      totalKobo: Number(o.total_kobo),
      paymentReference: pay?.provider_reference ?? o.order_number,
      paidAt: pay?.verified_at ?? null,
      shippingAddress: { line1: ship.line1, city: ship.city, state: ship.state, phone: ship.phone },
      trackingNumber: o.tracking_number,
      shippingProvider: o.shipping_provider,
      trackUrl: extra.trackUrl,
      reason: extra.reason
    }

    const templateId = Deno.env.get(`TERMII_TPL_${event.toUpperCase()}`)
    const results = await Promise.allSettled([
      sendTemplateEmail(o.email, templateId, orderSubject(event, data), orderTemplateVars(event, data)),
      sendSms(o.phone || ship.phone, orderSms(event, data))
    ])

    const [emailR, smsR] = results.map((r) => (r.status === 'fulfilled' ? r.value : { ok: false }))
    await db.from('audit_logs').insert({
      action,
      entity_type: 'order',
      entity_id: o.id,
      metadata: { email: emailR, sms: smsR }
    })
  } catch (e) {
    console.error('notifyOrder failed:', e)
  }
}