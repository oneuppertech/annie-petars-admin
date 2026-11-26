import {
  handle,
  reply,
  readJson,
  requireMethod,
  text,
  email,
  HttpError
} from '../_shared/http.ts'

import { getAdminClient } from '../_shared/supabaseAdmin.ts'
import { initTx } from '../_shared/paystack.ts'

Deno.serve(
  handle(async (req, cors) => {
    requireMethod(req, 'POST')

    const b = await readJson(req)

    const items = Array.isArray(b.items)
      ? b.items.slice(0, 50).map((i: any) => ({
          product_id: text(i?.productId, 64),
          variant_id: text(i?.variantId, 64) || null,
          qty: Math.floor(Number(i?.qty))
        }))
      : []

    if (
      !items.length ||
      items.some(i => !i.product_id || !(i.qty >= 1 && i.qty <= 99))
    ) {
      throw new HttpError(400, 'Invalid cart')
    }

    const shipping =
      b.shippingAddress && typeof b.shippingAddress === 'object'
        ? b.shippingAddress
        : {}

    // Delivery fee is now set inside create_order (per currency) and stored in orders.shipping_kobo
    const normalizedShipping = {
      ...shipping,
      name: text(b.name, 120)
    }

    const mail = email(b.email)
    const db = getAdminClient()

    const { data, error } = await db
      .rpc('create_order', {
        p_email: mail,
        p_phone: text(b.phone, 30) || null,
        p_items: items,
        p_shipping: normalizedShipping,
        p_note: text(b.note, 1000) || null
      })
      .single()

    if (error) {
      console.error('Create order error:', error)
      throw new HttpError(400, error.message)
    }

    const o = data as {
      order_id: string
      order_number: string
      total_kobo: number
      currency: string
      shipping_kobo: number
    }

    if (
      !o?.order_id ||
      !o?.order_number ||
      !o?.currency ||
      !Number.isFinite(Number(o.total_kobo)) ||
      !Number.isFinite(Number(o.shipping_kobo))
    ) {
      throw new HttpError(500, 'Invalid order response')
    }

    // Save the complete order amount in the order's currency.
    const { error: paymentError } = await db.from('payments').insert({
      order_id: o.order_id,
      provider: 'paystack',
      provider_reference: o.order_number,
      amount_kobo: o.total_kobo,
      currency: o.currency
    })

    if (paymentError) {
      console.error('Payment record error:', paymentError)
      throw new HttpError(500, 'Unable to create payment record')
    }

    // Initialize Paystack with the complete order amount and currency.
    const tx = await initTx({
      email: mail,
      amount: o.total_kobo,
      currency: o.currency,
      reference: o.order_number,
      callback_url: Deno.env.get('SHOP_URL') || 'https://shop.anniepetars.com',
      metadata: {
        order_id: o.order_id,
        order_number: o.order_number,
        delivery_fee_kobo: o.shipping_kobo,
        currency: o.currency
      }
    })

    return reply(cors, {
      orderNumber: o.order_number,
      authorizationUrl: tx.authorization_url,
      amount: o.total_kobo,
      currency: o.currency,
      deliveryFee: o.shipping_kobo
    })
  })
)