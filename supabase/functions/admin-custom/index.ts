// POST { action, ...payload } with the signed-in admin's JWT.
// Deploy with verify_jwt = false: this function verifies the token and the role itself.
// Actions: list, get, set_status, request_info, send_quote, record_payment, update, add_note, resend, delete
import { handle, reply, requireMethod, text, HttpError } from '../_shared/http.ts'
import { getAdminClient } from '../_shared/supabaseAdmin.ts'
import { notify, type NotifyKind } from '../_shared/customRequestNotify.ts'
import { initTx } from '../_shared/paystack.ts'

const READ_ROLES = new Set(['owner', 'admin', 'order_manager', 'support'])
const WRITE_ROLES = new Set(['owner', 'admin', 'order_manager'])
const BUCKET = 'custom-request-files'

// Lifecycle. 'quoted', 'paid' and 'needs_info' have dedicated actions because they need extra data.
const NEXT: Record<string, string[]> = {
  new: ['in_review', 'needs_info', 'quoted', 'declined', 'cancelled'],
  in_review: ['needs_info', 'quoted', 'declined', 'cancelled'],
  needs_info: ['in_review', 'quoted', 'declined', 'cancelled'],
  quoted: ['quoted', 'in_review', 'accepted', 'paid', 'declined', 'cancelled'],
  accepted: ['quoted', 'paid', 'cancelled'],
  paid: ['in_production'],
  in_production: ['ready'],
  ready: ['in_production', 'completed'],
  completed: [],
  declined: ['in_review'],
  cancelled: ['in_review']
}
const GENERIC = new Set([
  'in_review',
  'accepted',
  'in_production',
  'ready',
  'completed',
  'declined',
  'cancelled'
])
const CUSTOMER_NOTIFY: Record<string, NotifyKind> = {
  in_production: 'in_production',
  ready: 'ready',
  completed: 'completed',
  declined: 'declined',
  cancelled: 'cancelled'
}

const isoDate = (v: unknown) => (/^\d{4}-\d{2}-\d{2}$/.test(String(v ?? '')) ? String(v) : null)
const kobo = (v: unknown, label: string) => {
  const n = Number(v)
  if (!Number.isInteger(n) || n < 0 || n > 100_000_000_00)
    throw new HttpError(400, `${label} must be a valid amount`)
  return n
}

Deno.serve(
  handle(async (req, cors) => {
    requireMethod(req, 'POST')
    const db = getAdminClient()

    // ---- auth ----
    const jwt = (req.headers.get('authorization') || '').replace(/^Bearer\s+/i, '')
    if (!jwt) throw new HttpError(401, 'Sign in required')
    const { data: auth, error: authErr } = await db.auth.getUser(jwt)
    if (authErr || !auth?.user) throw new HttpError(401, 'Session expired. Sign in again')
    const uid = auth.user.id
    const { data: roleRow } = await db
      .from('user_roles')
      .select('role')
      .eq('user_id', uid)
      .maybeSingle()
    const role = String(roleRow?.role ?? '')
    if (!READ_ROLES.has(role)) throw new HttpError(403, 'You do not have access to custom requests')
    const canWrite = WRITE_ROLES.has(role)

    let b: Record<string, unknown> = {}
    try {
      b = await req.json()
    } catch {
      throw new HttpError(400, 'Invalid JSON body')
    }
    const action = String(b.action ?? '')
    const needWrite = () => {
      if (!canWrite) throw new HttpError(403, 'Your role cannot change requests')
    }

    // ---- helpers ----
    const load = async (id: unknown) => {
      const { data, error } = await db
        .from('custom_requests')
        .select('*')
        .eq('id', String(id ?? ''))
        .maybeSingle()
      if (error) throw new HttpError(500, error.message)
      if (!data) throw new HttpError(404, 'Request not found')
      return data
    }
    const log = (
      request_id: string,
      event_type: string,
      o: { from?: string; to?: string; note?: string | null; meta?: unknown } = {}
    ) =>
      db.from('custom_request_events').insert({
        request_id,
        actor_user_id: uid,
        event_type,
        from_status: o.from ?? null,
        to_status: o.to ?? null,
        note: o.note ?? null,
        metadata: o.meta ?? {}
      })
    const audit = (act: string, id: string, metadata: unknown = {}) =>
      db.from('audit_logs').insert({
        actor_user_id: uid,
        action: `custom_request.${act}`,
        entity_type: 'custom_request',
        entity_id: id,
        metadata
      })
    const bg = (p: Promise<unknown>) => {
      // @ts-ignore EdgeRuntime exists on Supabase edge
      if (typeof EdgeRuntime !== 'undefined') EdgeRuntime.waitUntil(p)
    }
    const fire = (kind: NotifyKind, row: any, extra = {}) =>
      bg(notify(kind, row, extra).catch((e) => console.error('notify failed', e)))

    const move = async (r: any, to: string, patch: Record<string, unknown> = {}) => {
      if (!NEXT[r.status]?.includes(to))
        throw new HttpError(409, `Cannot move from ${r.status} to ${to}`)
      const { data, error } = await db
        .from('custom_requests')
        .update({ ...patch, status: to, updated_at: new Date().toISOString() })
        .eq('id', r.id)
        .eq('status', r.status)
        .select('*')
        .maybeSingle()
      if (error) throw new HttpError(500, error.message)
      if (!data)
        throw new HttpError(409, 'Someone else changed this request. Refresh and try again')
      return data
    }

    // ================= LIST =================
    if (action === 'list') {
      const page = Math.max(1, Number(b.page) || 1)
      const size = Math.min(100, Math.max(5, Number(b.pageSize) || 20))
      let q = db
        .from('custom_requests')
        .select(
          'id,request_number,name,email,phone,outfit_type,status,needed_by,quote_kobo,shipping_quote_kobo,order_id,created_at,updated_at,last_customer_reply_at',
          { count: 'exact' }
        )
      const st = String(b.status ?? '')
      if (st && st !== 'all') q = q.eq('status', st)
      const term = String(b.q ?? '')
        .replace(/[,()%]/g, ' ')
        .trim()
        .slice(0, 80)
      if (term)
        q = q.or(
          `name.ilike.%${term}%,email.ilike.%${term}%,request_number.ilike.%${term}%,outfit_type.ilike.%${term}%`
        )
      const { data, count, error } = await q
        .order('created_at', { ascending: false })
        .range((page - 1) * size, page * size - 1)
      if (error) throw new HttpError(500, error.message)
      const { data: all } = await db.from('custom_requests').select('status').limit(5000)
      const counts: Record<string, number> = {}
      for (const row of all ?? []) counts[row.status] = (counts[row.status] || 0) + 1
      return reply(cors, {
        items: data ?? [],
        total: count ?? 0,
        counts,
        me: { role, can_write: canWrite }
      })
    }

    // ================= GET =================
    if (action === 'get') {
      const r = await load(b.id)
      const [{ data: files }, { data: events }, orderRes] = await Promise.all([
        db.from('custom_request_files').select('*').eq('request_id', r.id).order('created_at'),
        db
          .from('custom_request_events')
          .select('*')
          .eq('request_id', r.id)
          .order('created_at', { ascending: false })
          .limit(100),
        r.order_id
          ? db
              .from('orders')
              .select('id,order_number,status,payment_status,total_kobo')
              .eq('id', r.order_id)
              .maybeSingle()
          : Promise.resolve({ data: null })
      ])
      let signed: Record<string, string> = {}
      if (files?.length) {
        const { data: urls } = await db.storage.from(BUCKET).createSignedUrls(
          files.map((f) => f.storage_path),
          3600
        )
        for (const u of urls ?? []) if (u.signedUrl) signed[u.path ?? ''] = u.signedUrl
      }
      return reply(cors, {
        request: r,
        files: (files ?? []).map((f) => ({ ...f, url: signed[f.storage_path] || null })),
        events: events ?? [],
        order: orderRes.data ?? null,
        allowed: canWrite ? (NEXT[r.status] ?? []) : [],
        can_write: canWrite,
        role
      })
    }

    // everything below mutates
    needWrite()

    // ================= SET STATUS (generic) =================
    if (action === 'set_status') {
      const to = String(b.status ?? '')
      if (!GENERIC.has(to)) throw new HttpError(400, 'Use the dedicated action for this status')
      const r = await load(b.id)
      const message = text(b.message, 2000) || null
      if (to === 'declined' && !message)
        throw new HttpError(400, 'Add a short reason for the customer')
      const upd = await move(
        r,
        to,
        to === 'accepted' ? { accepted_at: new Date().toISOString() } : {}
      )
      await log(r.id, 'status', { from: r.status, to, note: message })
      await audit('status', r.id, { from: r.status, to })
      if (b.notify !== false && CUSTOMER_NOTIFY[to])
        fire(CUSTOMER_NOTIFY[to], upd, { message: message ?? undefined })
      return reply(cors, { success: true, request: upd })
    }

    // ================= REQUEST MORE INFO =================
    if (action === 'request_info') {
      const r = await load(b.id)
      const message = text(b.message, 2000)
      if (!message) throw new HttpError(400, 'Write what you need from the customer')
      const upd = await move(r, 'needs_info')
      await log(r.id, 'status', { from: r.status, to: 'needs_info', note: message })
      await audit('request_info', r.id)
      fire('needs_info', upd, { message })
      return reply(cors, { success: true, request: upd })
    }

    // ================= SEND QUOTE =================
    if (action === 'send_quote') {
      const r = await load(b.id)
      const quote = kobo(b.quote_kobo, 'Outfit price')
      const shipping = kobo(b.shipping_kobo ?? 0, 'Delivery')
      if (quote <= 0) throw new HttpError(400, 'Outfit price must be more than zero')
      let link = text(b.payment_link, 500) || null
      if (link && !/^https:\/\//i.test(link))
        throw new HttpError(400, 'Payment link must start with https://')
      const expires = isoDate(b.quote_expires_at)
      if (expires && expires < new Date().toISOString().slice(0, 10))
        throw new HttpError(400, 'Expiry date is in the past')
      if (b.generate_link === true && !link) {
        const tx = await initTx({
          email: r.email,
          amount: quote + shipping,
          currency: 'NGN',
          callback_url: Deno.env.get('SHOP_URL') || 'https://shop.anniepetars.com',
          reference: `${r.request_number}-${Date.now()}`,
          metadata: { source: 'custom_request', request_id: r.id, request_number: r.request_number }
        })
        link = tx.authorization_url
      }
      const timeline = text(b.agreed_timeline, 300) || null
      const message = text(b.message, 2000) || null
      const upd = await move(r, 'quoted', {
        quote_kobo: quote,
        shipping_quote_kobo: shipping,
        payment_link: link,
        quote_expires_at: expires,
        agreed_timeline: timeline,
        quote_note: message,
        quoted_at: new Date().toISOString()
      })
      await log(r.id, 'quote', {
        from: r.status,
        to: 'quoted',
        note: message,
        meta: { quote_kobo: quote, shipping_kobo: shipping, expires, timeline }
      })
      await audit('quote', r.id, { quote_kobo: quote, shipping_kobo: shipping })
      if (b.notify !== false) fire('quoted', upd, { message: message ?? undefined })
      return reply(cors, { success: true, request: upd })
    }

    // ================= RECORD PAYMENT -> ORDER =================
    if (action === 'record_payment') {
      const r = await load(b.id)
      if (r.status === 'paid' && r.order_id) return reply(cors, { success: true, already: true })
      if (!['quoted', 'accepted'].includes(r.status))
        throw new HttpError(409, 'Send a quote before recording payment')
      const total = (r.quote_kobo ?? 0) + (r.shipping_quote_kobo ?? 0)
      const amount = b.amount_kobo == null ? total : kobo(b.amount_kobo, 'Amount')
      const { data, error } = await db.rpc('convert_custom_request_to_order', {
        p_request_id: r.id,
        p_provider: text(b.provider, 40) || 'manual',
        p_reference: text(b.reference, 120) || null,
        p_amount_kobo: amount,
        p_actor: uid
      })
      if (error) {
        console.error(error)
        throw new HttpError(
          /Amount must equal|must be quoted|no quote/i.test(error.message) ? 400 : 500,
          error.message
        )
      }
      const row = Array.isArray(data) ? data[0] : data
      await audit('payment', r.id, { order_number: row?.out_order_number, amount_kobo: amount })
      const fresh = await load(r.id)
      if (b.notify !== false) fire('paid', fresh, { orderNumber: row?.out_order_number })
      return reply(cors, {
        success: true,
        order: { id: row?.out_order_id, order_number: row?.out_order_number },
        request: fresh
      })
    }
    // ================= REVERT PAYMENT =================
    if (action === 'revert_payment') {
      if (!['owner', 'admin'].includes(role))
        throw new HttpError(403, 'Only an owner or admin can revert a payment')
      const r = await load(b.id)
      if (!r.order_id || !['paid', 'in_production'].includes(r.status)) {
        throw new HttpError(409, 'This request has no payment to revert')
      }
      const reason = text(b.reason, 500)
      if (!reason) throw new HttpError(400, 'Add a reason for reverting the payment')

      const { data, error } = await db.rpc('revert_custom_request_payment', {
        p_request_id: r.id,
        p_actor: uid,
        p_reason: reason
      })
      if (error) {
        console.error(error)
        throw new HttpError(
          /no payment|already|not found|not marked/i.test(error.message) ? 409 : 500,
          error.message
        )
      }
      const row = Array.isArray(data) ? data[0] : data
      await audit('revert_payment', r.id, { order_number: row?.out_order_number, from: r.status })
      return reply(cors, { success: true, request: await load(r.id) })
    }

    // ================= UPDATE DETAILS =================
    if (action === 'update') {
      const r = await load(b.id)
      const patch: Record<string, unknown> = { updated_at: new Date().toISOString() }
      if ('internal_notes' in b) patch.internal_notes = text(b.internal_notes, 4000) || null
      if ('agreed_timeline' in b) patch.agreed_timeline = text(b.agreed_timeline, 300) || null
      if ('needed_by' in b) patch.needed_by = isoDate(b.needed_by)
      if ('event_date' in b) patch.event_date = isoDate(b.event_date)
      if ('quantity' in b) {
        const n = Number(b.quantity)
        if (!Number.isInteger(n) || n < 1 || n > 50)
          throw new HttpError(400, 'Quantity must be between 1 and 50')
        patch.quantity = n
      }
      if (r.order_id && 'quantity' in b)
        throw new HttpError(409, 'This request is already an order. Edit the order instead')
      const { error } = await db.from('custom_requests').update(patch).eq('id', r.id)
      if (error) throw new HttpError(500, error.message)
      await log(r.id, 'updated', { meta: Object.keys(patch).filter((k) => k !== 'updated_at') })
      await audit('update', r.id)
      return reply(cors, { success: true, request: await load(r.id) })
    }

    // ================= INTERNAL NOTE =================
    if (action === 'add_note') {
      const r = await load(b.id)
      const note = text(b.note, 2000)
      if (!note) throw new HttpError(400, 'Write a note first')
      await log(r.id, 'note', { note })
      return reply(cors, { success: true })
    }

    // ================= RESEND EMAIL =================
    if (action === 'resend') {
      const r = await load(b.id)
      const kind = String(b.kind ?? '')
      if (kind === 'received') fire('received', r)
      else if (kind === 'quoted' && r.quote_kobo != null)
        fire('quoted', r, { message: r.quote_note ?? undefined })
      else throw new HttpError(400, 'Nothing to resend for this request')
      await log(r.id, 'email', { note: `Resent "${kind}" email to customer` })
      return reply(cors, { success: true })
    }

    // ================= DELETE (owner only) =================
    if (action === 'delete') {
      if (role !== 'owner') throw new HttpError(403, 'Only the owner can delete requests')
      const r = await load(b.id)
      if (r.order_id)
        throw new HttpError(409, 'This request is linked to an order and cannot be deleted')
      const { data: files } = await db
        .from('custom_request_files')
        .select('storage_path')
        .eq('request_id', r.id)
      if (files?.length) await db.storage.from(BUCKET).remove(files.map((f) => f.storage_path))
      await db.from('custom_request_files').delete().eq('request_id', r.id)
      await db.from('custom_request_events').delete().eq('request_id', r.id)
      const { error } = await db.from('custom_requests').delete().eq('id', r.id)
      if (error) throw new HttpError(500, error.message)
      await audit('delete', r.id, { request_number: r.request_number })
      return reply(cors, { success: true })
    }

    throw new HttpError(400, 'Unknown action')
  })
)
