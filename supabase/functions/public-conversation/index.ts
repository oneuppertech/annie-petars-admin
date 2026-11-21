
import {
  handle,
  reply,
  requireMethod,
  HttpError
} from '../_shared/http.ts'

import { getAdminClient } from '../_shared/supabaseAdmin.ts'

const clean = (value: unknown, max = 10000) =>
  String(value ?? '').trim().slice(0, max)

async function sha256(value: string): Promise<string> {
  const bytes = new TextEncoder().encode(value)
  const digest = await crypto.subtle.digest('SHA-256', bytes)

  return Array.from(new Uint8Array(digest))
    .map(byte => byte.toString(16).padStart(2, '0'))
    .join('')
}

Deno.serve(handle(async (req, cors) => {
  requireMethod(req, 'POST')

  let body: Record<string, unknown> = {}

  try {
    body = await req.json()
  } catch {
    throw new HttpError(400, 'Invalid JSON body')
  }

  const action = clean(body.action, 30)
  const token = clean(body.token, 300)

  if (!token || token.length < 40 || token.length > 256) {
    throw new HttpError(401, 'This conversation link is invalid')
  }

  const tokenHash = await sha256(token)
  const db = getAdminClient()

  const { data: conversation, error } = await db
    .from('contact_messages')
    .select('id, name, enquiry_type, message, status, created_at, access_token_expires_at')
    .eq('access_token_hash', tokenHash)
    .maybeSingle()

  if (error) throw new HttpError(500, error.message)

  if (!conversation) {
    throw new HttpError(404, 'This conversation link is invalid or has expired')
  }

  if (
    conversation.access_token_expires_at &&
    new Date(conversation.access_token_expires_at).getTime() < Date.now()
  ) {
    throw new HttpError(410, 'This conversation link has expired')
  }

  if (conversation.status === 'spam') {
    throw new HttpError(403, 'This conversation is unavailable')
  }

  // ----------------------------------------------------------
  // GET PUBLIC CONVERSATION
  // ----------------------------------------------------------
  if (action === 'get') {
    const { data: replies, error: repliesError } = await db
      .from('contact_message_replies')
      .select('id, author_type, body, created_at')
      .eq('contact_message_id', conversation.id)
      .eq('is_internal', false)
      .order('created_at', { ascending: true })

    if (repliesError) throw new HttpError(500, repliesError.message)

    await db
      .from('contact_messages')
      .update({ last_visitor_read_at: new Date().toISOString() })
      .eq('id', conversation.id)

    return reply(cors, {
      success: true,
      conversation: {
        id: conversation.id,
        name: conversation.name,
        enquiry_type: conversation.enquiry_type,
        message: conversation.message,
        status: conversation.status,
        created_at: conversation.created_at,
        replies: replies ?? []
      }
    })
  }

  // ----------------------------------------------------------
  // VISITOR REPLY
  // ----------------------------------------------------------
  if (action === 'reply') {
    const content = clean(body.body, 10000)

    if (!content) throw new HttpError(400, 'Write a message first')

    if (conversation.status === 'spam') {
      throw new HttpError(403, 'This conversation is unavailable')
    }

    const { data: inserted, error: insertError } = await db
      .from('contact_message_replies')
      .insert({
        contact_message_id: conversation.id,
        author_type: 'visitor',
        author_user_id: null,
        body: content,
        is_internal: false
      })
      .select('id, author_type, body, created_at')
      .single()

    if (insertError) throw new HttpError(500, insertError.message)

    const updates: Record<string, unknown> = {
      last_message_at: inserted.created_at,
      last_visitor_read_at: inserted.created_at
    }

    if (conversation.status === 'resolved') {
      updates.status = 'in_progress'
    }

    const { error: updateError } = await db
      .from('contact_messages')
      .update(updates)
      .eq('id', conversation.id)

    if (updateError) throw new HttpError(500, updateError.message)

    return reply(cors, {
      success: true,
      message: 'Your reply has been received',
      reply: inserted
    })
  }

  throw new HttpError(400, 'Unknown action')
}))
