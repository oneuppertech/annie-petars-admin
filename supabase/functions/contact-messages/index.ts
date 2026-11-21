
import {
  handle,
  reply,
  requireMethod,
  HttpError
} from '../_shared/http.ts'

import { getAdminClient } from '../_shared/supabaseAdmin.ts'

const ALLOWED_TYPES = [
  'General enquiry',
  'Customer service',
  'Custom outfit',
  'Press / media',
  'Sponsorship',
  'Partnership',
  'Retail',
  'Event / exhibition'
]

const TOKEN_VALIDITY_DAYS = 180

function clean(value: unknown, maxLength: number): string {
  if (typeof value !== 'string') return ''

  return value
    .trim()
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '')
    .slice(0, maxLength)
}

function generateToken(): string {
  const bytes = new Uint8Array(32)

  crypto.getRandomValues(bytes)

  return Array.from(bytes)
    .map(byte => byte.toString(16).padStart(2, '0'))
    .join('')
}

async function hashToken(token: string): Promise<string> {
  const encoded = new TextEncoder().encode(token)

  const digest = await crypto.subtle.digest('SHA-256', encoded)

  return Array.from(new Uint8Array(digest))
    .map(byte => byte.toString(16).padStart(2, '0'))
    .join('')
}

Deno.serve(
  handle(async (req, cors) => {
    requireMethod(req, 'POST')

    let payload: Record<string, unknown>

    try {
      payload = await req.json()
    } catch {
      throw new HttpError(400, 'Invalid JSON request body.')
    }

    const name = clean(payload.name, 120)
    const email = clean(payload.email, 254).toLowerCase()
    const enquiryType = clean(payload.enquiry_type, 80)
    const message = clean(payload.message, 5000)

    if (!name || !email || !message) {
      throw new HttpError(
        400,
        'Name, email and message are required.'
      )
    }

    const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

    if (!emailPattern.test(email)) {
      throw new HttpError(400, 'Please provide a valid email address.')
    }

    if (message.length < 5) {
      throw new HttpError(
        400,
        'Your message must contain at least 5 characters.'
      )
    }

    if (!ALLOWED_TYPES.includes(enquiryType)) {
      throw new HttpError(400, 'Invalid enquiry type.')
    }

    // Generate a private visitor conversation token.
    const token = generateToken()
    const tokenHash = await hashToken(token)

    const expiresAt = new Date(
      Date.now() + TOKEN_VALIDITY_DAYS * 24 * 60 * 60 * 1000
    ).toISOString()

    const supabase = getAdminClient()

    const { data, error } = await supabase
      .from('contact_messages')
      .insert({
        name,
        email,
        enquiry_type: enquiryType,
        message,
        status: 'new',
        access_token_hash: tokenHash,
        access_token_expires_at: expiresAt,
        last_message_at: new Date().toISOString()
      })
      .select('id')
      .single()

    if (error) {
      console.error(
        '[contact-message] Database insert failed:',
        error
      )

      throw new HttpError(
        500,
        'We could not save your message. Please try again.'
      )
    }

    return reply(
      cors,
      {
        success: true,
        message: 'Your enquiry has been received successfully.',
        data: {
          id: data.id,

          // Returned only once. Never save this raw token.
          conversation: {
            token,
            path: `/conversation/${token}`,
            expires_at: expiresAt
          }
        }
      },
      201
    )
  })
)
