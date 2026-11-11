// _shared/termii.ts
// Env: TERMII_API_KEY, TERMII_SENDER_ID
// Optional: TERMII_BASE_URL (use the base URL shown on your Termii dashboard,
//           default https://api.ng.termii.com), TERMII_CHANNEL ('generic' | 'dnd', default 'generic')

export interface SmsResult {
  ok: boolean
  id?: string
  error?: string
}

// Termii wants international format with no "+": 2348012345678
export function toMsisdn(raw?: string | null): string | null {
  let d = String(raw ?? '').replace(/\D/g, '')
  if (d.startsWith('00')) d = d.slice(2)
  if (d.startsWith('234') && d.length === 13) return d
  if (d.length === 11 && d.startsWith('0')) return '234' + d.slice(1)
  if (d.length === 10) return '234' + d
  return d.length >= 11 ? d : null
}

export async function sendSms(to: string | null | undefined, message: string): Promise<SmsResult> {
  const apiKey = Deno.env.get('TERMII_API_KEY')
  const from = Deno.env.get('TERMII_SENDER_ID')
  const base = (Deno.env.get('TERMII_BASE_URL') || 'https://api.ng.termii.com').replace(/\/$/, '')
  const channel = Deno.env.get('TERMII_CHANNEL') || 'generic'

  if (!apiKey || !from) return { ok: false, error: 'Termii is not configured' }
  const msisdn = toMsisdn(to)
  if (!msisdn) return { ok: false, error: 'Invalid phone number' }

  try {
    const res = await fetch(`${base}/api/sms/send`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        api_key: apiKey,
        to: msisdn,
        from,
        sms: message,
        type: 'plain',
        channel
      })
    })
    const body = await res.json().catch(() => ({}))
    if (!res.ok) {
      console.error('Termii SMS failed:', res.status, body)
      return { ok: false, error: body?.message || `HTTP ${res.status}` }
    }
    return { ok: true, id: body?.message_id }
  } catch (e) {
    console.error('Termii SMS error:', e)
    return { ok: false, error: (e as Error).message }
  }
}

// Templated email via Termii's "Email Product Notification" API.
// Env: TERMII_EMAIL_CONFIG_ID (your email configuration id) and one template id per event:
//   TERMII_TPL_PLACED, TERMII_TPL_SHIPPED, TERMII_TPL_DELIVERED, TERMII_TPL_CANCELLED, TERMII_TPL_RETURNED

export async function sendTemplateEmail(
  to: string,
  templateId: string | undefined,
  subject: string,
  variables: Record<string, string>
): Promise<SmsResult> {
  const apiKey = Deno.env.get('TERMII_API_KEY')
  const configId = Deno.env.get('TERMII_EMAIL_CONFIG_ID')

  const base = (
    Deno.env.get('TERMII_BASE_URL') ||
    'https://api.ng.termii.com'
  ).replace(/\/$/, '')

  if (!apiKey || !configId || !templateId) {
    return {
      ok: false,
      error: 'Termii email configuration is incomplete'
    }
  }

  if (!to || !subject) {
    return {
      ok: false,
      error: 'Recipient email and subject are required'
    }
  }

  try {
    const res = await fetch(`${base}/api/templates/send-email`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        api_key: apiKey,
        email: to,
        template_id: templateId,
        email_configuration_id: configId,
        subject,
        variables
      })
    })

    const body = await res.json().catch(() => ({}))

    if (!res.ok || (body?.code && body.code !== 'ok')) {
      console.error('Termii email failed:', {
        status: res.status,
        response: body
      })

      return {
        ok: false,
        error: body?.message || `Termii HTTP ${res.status}`
      }
    }

    return {
      ok: true,
      id: body?.message_id
    }
  } catch (e) {
    console.error('Termii email error:', e)

    return {
      ok: false,
      error: (e as Error).message
    }
  }
}
