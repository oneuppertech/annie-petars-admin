import { handle, reply, requireMethod, HttpError } from '../_shared/http.ts'
import { validSignature } from '../_shared/paystack.ts'
import { settle } from '../_shared/settle.ts'
import { getAdminClient } from '../_shared/supabaseAdmin.ts'
import { notify } from '../_shared/customRequestNotify.ts'

// Errors retrying will never fix: record on the request, answer 200.
const PERMANENT = /Amount must equal|must be quoted|no quote|Request not found/i

// Accepts the new shape (source + request_id) and links already sent (custom_request_id)
const customRequestId = (d: any): string | null => {
  const m = d?.metadata
  if (!m || typeof m !== 'object') return null
  return m.request_id ?? m.custom_request_id ?? null
}

async function settleCustomRequest(d: any, requestId: string) {
  if (d?.currency !== 'NGN') {
    console.error('Custom request payment in unexpected currency', { requestId, currency: d?.currency })
    return
  }

  const db = getAdminClient()
  const { data: before } = await db
    .from('custom_requests')
    .select('id, order_id')
    .eq('id', requestId)
    .maybeSingle()
  if (!before || before.order_id) return // unknown request, or already converted

  const { data, error } = await db.rpc('convert_custom_request_to_order', {
    p_request_id: requestId,
    p_provider: 'paystack',
    p_reference: d.reference,
    p_amount_kobo: d.amount,
    p_actor: null
  })

  if (error) {
    console.error('CUSTOM REQUEST PAYMENT NEEDS ATTENTION', {
      request: d?.metadata?.request_number,
      reference: d.reference,
      amount: d.amount,
      error: error.message
    })
    if (PERMANENT.test(error.message)) {
      // Visible in the drawer's Activity timeline
      await db
        .from('custom_request_events')
        .insert({
          request_id: requestId,
          event_type: 'payment_error',
          note: error.message,
          metadata: { reference: d.reference, amount_kobo: d.amount, provider: 'paystack' }
        })
        .then(({ error: e }) => e && console.error('event insert failed', e.message))
      return
    }
    throw new HttpError(500, error.message) // transient: non-200 makes Paystack retry
  }

  const row = Array.isArray(data) ? data[0] : data

  await db
    .from('audit_logs')
    .insert({
      action: 'custom_request.payment',
      entity_type: 'custom_request',
      entity_id: requestId,
      metadata: { order_number: row?.out_order_number, source: 'paystack_webhook', reference: d.reference }
    })
    .then(({ error: e }) => e && console.error('audit insert failed', e.message))

  const { data: fresh } = await db.from('custom_requests').select('*').eq('id', requestId).maybeSingle()
  if (fresh) {
    await notify('paid', fresh, { orderNumber: row?.out_order_number }).catch((e) =>
      console.error('notify failed', e)
    )
  }
}

Deno.serve(
  handle(async (req, cors) => {
    requireMethod(req, 'POST')
    const raw = await req.text()
    if (!(await validSignature(raw, req.headers.get('x-paystack-signature'))))
      throw new HttpError(401, 'Bad signature')

    let evt: any
    try {
      evt = JSON.parse(raw)
    } catch {
      throw new HttpError(400, 'Invalid JSON body')
    }

    if (evt.event === 'charge.success') {
      const requestId = customRequestId(evt.data)
      if (requestId) await settleCustomRequest(evt.data, requestId)
      else await settle(evt.data)
    }

    return reply(cors, { received: true })
  })
)