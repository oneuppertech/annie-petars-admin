import { handle, reply, requireMethod, HttpError } from '../_shared/http.ts'

import { getAdminClient } from '../_shared/supabaseAdmin.ts'

const READ_ROLES = new Set(['owner', 'admin', 'support'])
const STATUSES = new Set(['new', 'in_progress', 'resolved', 'spam'])

const clean = (value: unknown, max = 10000) =>
  String(value ?? '')
    .trim()
    .slice(0, max)

Deno.serve(
  handle(async (req, cors) => {
    requireMethod(req, 'POST')

    const db = getAdminClient()

    // ----------------------------------------------------------
    // Authenticate the signed-in admin.
    // ----------------------------------------------------------
    const jwt = (req.headers.get('authorization') || '').replace(/^Bearer\s+/i, '')

    if (!jwt) throw new HttpError(401, 'Sign in required')

    const { data: auth, error: authError } = await db.auth.getUser(jwt)

    if (authError || !auth?.user) {
      throw new HttpError(401, 'Session expired. Sign in again')
    }

    const uid = auth.user.id

    const { data: roleRecord, error: roleError } = await db
      .from('user_roles')
      .select('role')
      .eq('user_id', uid)
      .maybeSingle()

    if (roleError) {
      console.error('Admin role lookup failed:', roleError)
      throw new HttpError(500, 'Unable to verify administrator permissions')
    }

    if (!roleRecord || !READ_ROLES.has(roleRecord.role)) {
      throw new HttpError(403, 'You are not authorized to access messages')
    }

    let body: Record<string, unknown> = {}

    try {
      body = await req.json()
    } catch {
      throw new HttpError(400, 'Invalid JSON body')
    }

    const action = clean(body.action, 40)

    const loadMessage = async (id: unknown) => {
      const messageId = clean(id, 80)

      if (!messageId) throw new HttpError(400, 'Message ID is required')

      const { data, error } = await db
        .from('contact_messages')
        .select('*')
        .eq('id', messageId)
        .maybeSingle()

      if (error) throw new HttpError(500, error.message)
      if (!data) throw new HttpError(404, 'Conversation not found')

      return data
    }

    const loadReplies = async (id: string) => {
      const { data, error } = await db
        .from('contact_message_replies')
        .select(
          'id, contact_message_id, author_type, author_user_id, body, is_internal, created_at'
        )
        .eq('contact_message_id', id)
        .order('created_at', { ascending: true })

      if (error) throw new HttpError(500, error.message)

      return data ?? []
    }

    // ----------------------------------------------------------
    // LIST INBOX
    // ----------------------------------------------------------
    if (action === 'list') {
      const page = Math.max(1, Number(body.page) || 1)
      const limit = Math.min(50, Math.max(1, Number(body.limit) || 20))
      const offset = (page - 1) * limit

      const status = clean(body.status, 30)
      const search = clean(body.search, 120)

      let query = db
        .from('contact_messages')
        .select(
          'id, name, email, enquiry_type, message, status, created_at, last_message_at, last_admin_read_at, last_visitor_read_at',
          { count: 'exact' }
        )
        .order('last_message_at', { ascending: false, nullsFirst: false })
        .range(offset, offset + limit - 1)

      if (status && status !== 'all') {
        if (!STATUSES.has(status)) throw new HttpError(400, 'Invalid status filter')
        query = query.eq('status', status)
      }

      if (search) {
        const safeSearch = search.replace(/[,%()]/g, ' ')
        query = query.or(
          `name.ilike.%${safeSearch}%,email.ilike.%${safeSearch}%,message.ilike.%${safeSearch}%,enquiry_type.ilike.%${safeSearch}%`
        )
      }

      const { data, error, count } = await query

      if (error) throw new HttpError(500, error.message)

      const rows = data ?? []

      const ids = rows.map((row) => row.id)

      let replyCounts: Record<string, number> = {}

      if (ids.length) {
        const { data: replies, error: replyError } = await db
          .from('contact_message_replies')
          .select('contact_message_id')
          .in('contact_message_id', ids)
          .eq('is_internal', false)

        if (replyError) throw new HttpError(500, replyError.message)

        for (const item of replies ?? []) {
          replyCounts[item.contact_message_id] = (replyCounts[item.contact_message_id] ?? 0) + 1
        }
      }

      const unread = rows.filter((row) => {
        const lastVisitorRead = row.last_visitor_read_at
          ? new Date(row.last_visitor_read_at).getTime()
          : 0

        const lastActivity = row.last_message_at
          ? new Date(row.last_message_at).getTime()
          : new Date(row.created_at).getTime()

        return lastActivity > lastVisitorRead
      }).length

      return reply(cors, {
        success: true,
        messages: rows.map((row) => ({
          ...row,
          reply_count: replyCounts[row.id] ?? 0,
          unread_by_visitor: false,
          unread_by_admin:
            new Date(row.last_visitor_message_at || row.created_at).getTime() >
            (row.last_admin_read_at ? new Date(row.last_admin_read_at).getTime() : 0)
        })),
        meta: {
          page,
          limit,
          total: count ?? 0,
          pages: Math.ceil((count ?? 0) / limit),
          unread
        }
      })
    }

    // ----------------------------------------------------------
    // GET ONE CONVERSATION
    // ----------------------------------------------------------
    if (action === 'get') {
      const message = await loadMessage(body.id)

      const replies = await loadReplies(message.id)

      return reply(cors, {
        success: true,
        conversation: {
          ...message,
          replies
        }
      })
    }

    // ----------------------------------------------------------
    // ADMIN REPLY
    // ----------------------------------------------------------
    if (action === 'reply') {
      const message = await loadMessage(body.id)
      const content = clean(body.body, 10000)

      if (!content) throw new HttpError(400, 'Write a reply first')

      if (message.status === 'spam') {
        throw new HttpError(409, 'Move this conversation out of spam before replying')
      }

      const { data: inserted, error } = await db
        .from('contact_message_replies')
        .insert({
          contact_message_id: message.id,
          author_type: 'admin',
          author_user_id: uid,
          body: content,
          is_internal: false
        })
        .select('*')
        .single()

      if (error) throw new HttpError(500, error.message)

      const updates: Record<string, unknown> = {
        last_message_at: inserted.created_at,
        last_admin_read_at: inserted.created_at
      }

      if (message.status === 'new') updates.status = 'in_progress'

      const { error: updateError } = await db
        .from('contact_messages')
        .update(updates)
        .eq('id', message.id)

      if (updateError) throw new HttpError(500, updateError.message)

      return reply(cors, {
        success: true,
        message: 'Reply added',
        reply: inserted
      })
    }

    // ----------------------------------------------------------
    // PRIVATE INTERNAL NOTE
    // ----------------------------------------------------------
    if (action === 'add_note') {
      const message = await loadMessage(body.id)
      const content = clean(body.body, 10000)

      if (!content) throw new HttpError(400, 'Write a note first')

      const { data, error } = await db
        .from('contact_message_replies')
        .insert({
          contact_message_id: message.id,
          author_type: 'admin',
          author_user_id: uid,
          body: content,
          is_internal: true
        })
        .select('*')
        .single()

      if (error) throw new HttpError(500, error.message)

      return reply(cors, {
        success: true,
        message: 'Private note added',
        reply: data
      })
    }

    // ----------------------------------------------------------
    // STATUS
    // ----------------------------------------------------------
    if (action === 'set_status') {
      const message = await loadMessage(body.id)
      const status = clean(body.status, 30)

      if (!STATUSES.has(status)) {
        throw new HttpError(400, 'Invalid conversation status')
      }

      const { data, error } = await db
        .from('contact_messages')
        .update({ status })
        .eq('id', message.id)
        .select('*')
        .single()

      if (error) throw new HttpError(500, error.message)

      return reply(cors, {
        success: true,
        message: 'Conversation status updated',
        conversation: data
      })
    }

    // ----------------------------------------------------------
    // ADMIN READ RECEIPT
    // ----------------------------------------------------------
    if (action === 'mark_read') {
      const message = await loadMessage(body.id)

      const { error } = await db
        .from('contact_messages')
        .update({ last_admin_read_at: new Date().toISOString() })
        .eq('id', message.id)

      if (error) throw new HttpError(500, error.message)

      return reply(cors, { success: true })
    }

    throw new HttpError(400, 'Unknown action')
  })
)
