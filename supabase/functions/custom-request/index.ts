// Public, token-based endpoint behind /custom-request/:token on the shop site.
// Deploy with verify_jwt = false. The 32-char random token is the credential.
import { handle, reply, requireMethod, text, HttpError } from '../_shared/http.ts'
import { getAdminClient } from '../_shared/supabaseAdmin.ts'
import { notify } from '../_shared/customRequestNotify.ts'

const REPLY_STATES = new Set(['new', 'in_review', 'needs_info', 'quoted', 'accepted'])

Deno.serve(handle(async (req, cors) => {
  requireMethod(req, 'POST')
  let b: Record<string, unknown> = {}
  try { b = await req.json() } catch { throw new HttpError(400, 'Invalid JSON body') }

  const token = String(b.token ?? '')
  if (!/^[a-f0-9]{32}$/.test(token)) throw new HttpError(404, 'Request not found')

  const db = getAdminClient()
  const { data: r, error } = await db.from('custom_requests').select('*').eq('public_token', token).maybeSingle()
  if (error) { console.error(error); throw new HttpError(500, 'Could not load request') }
  if (!r) throw new HttpError(404, 'Request not found')

  const action = String(b.action ?? 'get')
  const todayIso = new Date().toISOString().slice(0, 10)
  const expired = !!r.quote_expires_at && r.quote_expires_at < todayIso

  const emitNotify = (kind: Parameters<typeof notify>[0], extra = {}) => {
    const p = notify(kind, r, extra).catch((e) => console.error('notify failed', e))
    // @ts-ignore EdgeRuntime exists on Supabase edge
    if (typeof EdgeRuntime !== 'undefined') EdgeRuntime.waitUntil(p)
  }

  if (action === 'accept') {
    if (r.status !== 'quoted') throw new HttpError(409, 'There is no open quote to accept')
    if (expired) throw new HttpError(409, 'This quote has expired. Please contact us for a new one')
    const { data: upd } = await db.from('custom_requests')
      .update({ status: 'accepted', accepted_at: new Date().toISOString(), updated_at: new Date().toISOString() })
      .eq('id', r.id).eq('status', 'quoted').select('id').maybeSingle()
    if (!upd) throw new HttpError(409, 'This request was just updated. Refresh the page')
    await db.from('custom_request_events').insert({
      request_id: r.id, event_type: 'status', from_status: 'quoted', to_status: 'accepted', note: 'Customer accepted the quote'
    })
    emitNotify('admin_accepted', {})
    return reply(cors, { success: true, status: 'accepted' })
  }

  if (action === 'reply') {
    const message = text(b.message, 2000)
    if (!message) throw new HttpError(400, 'Write a message first')
    if (!REPLY_STATES.has(r.status)) throw new HttpError(409, 'This request is closed for replies')
    const next = r.status === 'needs_info' ? 'in_review' : r.status
    await db.from('custom_requests')
      .update({ status: next, last_customer_reply_at: new Date().toISOString(), updated_at: new Date().toISOString() })
      .eq('id', r.id)
    await db.from('custom_request_events').insert({
      request_id: r.id, event_type: 'customer_reply', from_status: r.status, to_status: next, note: message
    })
    emitNotify('admin_reply', { message })
    return reply(cors, { success: true, status: next })
  }

  // action === 'get': only fields a customer should see
  let bank: unknown = null
  if (['quoted', 'accepted'].includes(r.status)) {
    const { data: s } = await db.from('shop_settings').select('value').eq('key', 'bank_details').maybeSingle()
    bank = s?.value ?? null
  }
  const { data: events } = await db.from('custom_request_events')
    .select('event_type,to_status,note,created_at')
    .eq('request_id', r.id).in('event_type', ['status', 'quote', 'customer_reply'])
    .order('created_at', { ascending: false }).limit(30)

  return reply(cors, {
    request: {
      request_number: r.request_number,
      name: r.name,
      outfit_type: r.outfit_type,
      status: r.status,
      needed_by: r.needed_by,
      created_at: r.created_at,
      quote_kobo: r.quote_kobo,
      shipping_quote_kobo: r.shipping_quote_kobo,
      quote_note: r.quote_note,
      quote_expires_at: r.quote_expires_at,
      quote_expired: expired,
      agreed_timeline: r.agreed_timeline,
      payment_link: ['quoted', 'accepted'].includes(r.status) && !expired ? r.payment_link : null,
      paid_at: r.paid_at
    },
    bank,
    // customers only see public-safe timeline entries (no internal notes)
    timeline: (events ?? []).map((e) => ({
      type: e.event_type, status: e.to_status, created_at: e.created_at,
      note: e.event_type === 'customer_reply' ? e.note : null
    }))
  })
}))