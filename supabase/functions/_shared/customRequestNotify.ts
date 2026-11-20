// _shared/customRequestNotify.ts
// Secrets: TERMII_API_KEY, TERMII_EMAIL_CONFIG_ID, TERMII_TPL_CUSTOM (one template for ALL custom-request emails),
//          ANNIE_LOGO_URL, SHOP_PUBLIC_URL (e.g. https://anniepetars.com), ADMIN_PUBLIC_URL (e.g. https://admin.anniepetars.com),
//          ADMIN_NOTIFY_EMAILS (comma separated), SUPPORT_EMAIL (optional), TERMII_SENDER_ID (for SMS)
import { sendTemplateEmail } from './termii.ts'

export interface CRRow {
  id?: string
  request_number: string
  public_token: string
  name: string
  email: string
  phone?: string | null
  country?: string | null
  outfit_type: string
  needed_by?: string | null
  status?: string
  quote_kobo?: number | null
  shipping_quote_kobo?: number | null
  quote_expires_at?: string | null
  agreed_timeline?: string | null
  notes?: string | null
}

export type NotifyKind =
  | 'received' | 'needs_info' | 'quoted' | 'paid' | 'in_production' | 'ready' | 'completed' | 'declined' | 'cancelled'
  | 'admin_new' | 'admin_reply' | 'admin_accepted'

export interface NotifyExtra {
  message?: string      // free text from admin or customer
  orderNumber?: string
}

const env = (k: string) => Deno.env.get(k) || ''
const strip = (u: string) => u.replace(/\/$/, '')

const naira = (k?: number | null) =>
  '₦' + ((Number(k) || 0) / 100).toLocaleString('en-NG', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

const dateLabel = (d?: string | null, fallback = 'Not specified') => {
  if (!d) return fallback
  const dt = new Date(d.length === 10 ? d + 'T00:00:00Z' : d)
  return isNaN(dt.getTime())
    ? fallback
    : dt.toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' })
}

export const STATUS_LABEL: Record<string, string> = {
  new: 'Received', in_review: 'In review', needs_info: 'More information needed', quoted: 'Quote ready',
  accepted: 'Quote accepted', paid: 'Paid, order confirmed', in_production: 'Being made', ready: 'Ready',
  completed: 'Completed', declined: 'Unable to proceed', cancelled: 'Cancelled'
}

type Row = [string, string]
interface Composed {
  subject: string
  headline: string
  message: string
  rows: Row[]           // exactly 5
  noteTitle: string
  noteBody: string
  ctaLabel: string
  ctaUrl: string
  sms?: string
}

function compose(kind: NotifyKind, r: CRRow, x: NotifyExtra): Composed {
  const shop = strip(env('SHOP_URL'))
  const admin = strip(env('ADMIN_PUBLIC_URL'))
  const statusUrl = `${shop}/custom-request/${r.public_token}`
  const adminUrl = `${admin}/custom-requests?open=${r.id ?? ''}`
  const total = (r.quote_kobo ?? 0) + (r.shipping_quote_kobo ?? 0)
  const base: Row[] = [
    ['Reference', r.request_number],
    ['Outfit', r.outfit_type],
    ['Date needed', dateLabel(r.needed_by)],
    ['Delivery country', r.country || 'Not specified'],
    ['Status', STATUS_LABEL[r.status || 'new'] || 'Received']
  ]
  const view = { ctaLabel: 'View your request', ctaUrl: statusUrl }

  switch (kind) {
    case 'received':
      return {
        subject: `We received your request ${r.request_number}`,
        headline: 'We have your request',
        message: 'Thank you for choosing Annie Petars. Your custom request has reached our team. This is an enquiry only and does not confirm an order.',
        rows: base, noteTitle: 'What happens next',
        noteBody: 'We review your design and measurements, then send you a quote and timeline. Nothing is made until you agree and pay.',
        ...view,
        sms: `Annie Petars: we received your custom request ${r.request_number}. We will review it and email you a quote. Track it: ${statusUrl}`
      }
    case 'needs_info':
      return {
        subject: `A quick question about ${r.request_number}`,
        headline: 'We need a little more from you',
        message: x.message || 'Please reply with a few more details so we can continue.',
        rows: base, noteTitle: 'How to reply',
        noteBody: 'Use the button below to send your answer. We will pick it up straight away.',
        ctaLabel: 'Reply to us', ctaUrl: statusUrl
      }
    case 'quoted':
      return {
        subject: `Your quote for ${r.request_number} is ready`,
        headline: 'Your quote is ready',
        message: x.message || 'We have reviewed your request and prepared a quote for you.',
        rows: [
          ['Reference', r.request_number], ['Outfit', r.outfit_type],
          ['Outfit price', naira(r.quote_kobo)], ['Delivery', naira(r.shipping_quote_kobo)], ['Total', naira(total)]
        ],
        noteTitle: 'Timeline and validity',
        noteBody: `${r.agreed_timeline || 'We will confirm timing once payment is received.'}${r.quote_expires_at ? ' Quote valid until ' + dateLabel(r.quote_expires_at) + '.' : ''}`,
        ctaLabel: 'View quote and pay', ctaUrl: statusUrl,
        sms: `Annie Petars: your quote for ${r.request_number} is ready (total ${naira(total)}). View and pay: ${statusUrl}`
      }
    case 'paid':
      return {
        subject: `Payment received, order ${x.orderNumber || r.request_number} confirmed`,
        headline: 'Payment received',
        message: 'Thank you. Your order is confirmed and your outfit moves into production.',
        rows: [
          ['Reference', r.request_number], ['Order number', x.orderNumber || 'Pending'],
          ['Outfit', r.outfit_type], ['Amount paid', naira(total)], ['Timeline', r.agreed_timeline || 'We will confirm shortly']
        ],
        noteTitle: 'Delivery details', noteBody: 'We will contact you to confirm your delivery address before your outfit ships.',
        ...view,
        sms: `Annie Petars: payment received. Order ${x.orderNumber || r.request_number} is confirmed. Thank you!`
      }
    case 'in_production':
      return {
        subject: `Your outfit ${r.request_number} is being made`,
        headline: 'Your outfit is being made',
        message: x.message || 'Our tailors have started work on your outfit.',
        rows: base, noteTitle: 'Timeline', noteBody: r.agreed_timeline || 'We will keep you updated.', ...view
      }
    case 'ready':
      return {
        subject: `Your outfit ${r.request_number} is ready`,
        headline: 'Your outfit is ready',
        message: x.message || 'Your outfit is finished. We will be in touch about delivery or collection.',
        rows: base, noteTitle: 'Next step', noteBody: 'Reply to this email or check your request page for delivery updates.', ...view,
        sms: `Annie Petars: your outfit ${r.request_number} is ready. We will contact you about delivery.`
      }
    case 'completed':
      return {
        subject: `Order ${r.request_number} completed`,
        headline: 'All done',
        message: x.message || 'Your custom order is complete. Thank you for trusting Annie Petars with it.',
        rows: base, noteTitle: 'We would love to hear from you', noteBody: 'Share a photo of your outfit with us. It means a lot to a small team.', ...view
      }
    case 'declined':
      return {
        subject: `Update on your request ${r.request_number}`,
        headline: 'We cannot take this one on',
        message: x.message || 'After reviewing your request, we are not able to proceed with it.',
        rows: base, noteTitle: 'Other options', noteBody: 'You are welcome to submit a new request with different details or browse our ready-to-wear collections.', ...view
      }
    case 'cancelled':
      return {
        subject: `Request ${r.request_number} cancelled`,
        headline: 'Request cancelled',
        message: x.message || 'This custom request has been cancelled.',
        rows: base, noteTitle: 'Need anything else?', noteBody: 'Reply to this email and we will help.', ...view
      }
    case 'admin_new':
      return {
        subject: `New custom request ${r.request_number} from ${r.name}`,
        headline: 'New custom request',
        message: `${r.name} just submitted a custom request. Review the design, measurements and references, then send a quote.`,
        rows: [
          ['Reference', r.request_number], ['Customer', r.name], ['Email', r.email],
          ['Phone', r.phone || 'Not provided'], ['Outfit', r.outfit_type]
        ],
        noteTitle: `Needed by ${dateLabel(r.needed_by)}`, noteBody: r.notes || 'No extra notes.',
        ctaLabel: 'Open in admin', ctaUrl: adminUrl
      }
    case 'admin_reply':
      return {
        subject: `${r.name} replied on ${r.request_number}`,
        headline: 'Customer replied',
        message: `${r.name} sent a reply on request ${r.request_number}.`,
        rows: [
          ['Reference', r.request_number], ['Customer', r.name], ['Email', r.email],
          ['Phone', r.phone || 'Not provided'], ['Status', STATUS_LABEL[r.status || 'new'] || '']
        ],
        noteTitle: 'Their message', noteBody: x.message || '', ctaLabel: 'Open in admin', ctaUrl: adminUrl
      }
    case 'admin_accepted':
      return {
        subject: `${r.name} accepted the quote for ${r.request_number}`,
        headline: 'Quote accepted',
        message: `${r.name} accepted the quote. Once payment arrives, record it in admin to turn this request into an order.`,
        rows: [
          ['Reference', r.request_number], ['Customer', r.name], ['Email', r.email],
          ['Outfit', r.outfit_type], ['Total', naira(total)]
        ],
        noteTitle: 'Next step', noteBody: 'Wait for payment, then use Record payment on the request.',
        ctaLabel: 'Open in admin', ctaUrl: adminUrl
      }
  }
}

export async function notify(kind: NotifyKind, r: CRRow, x: NotifyExtra = {}): Promise<void> {
  const c = compose(kind, r, x)
  const isAdmin = kind.startsWith('admin_')
  const tpl = env('TERMII_TPL_CUSTOM')
  const first = (r.name || '').trim().split(/\s+/)[0] || 'there'

  const variables: Record<string, string> = {
    logo_url: env('EMAIL_ASSETS_URL'),
    preheader: c.headline,
    headline: c.headline,
    greeting: isAdmin ? 'Hello team,' : `Hello ${first},`,
    message: c.message,
    row1_label: c.rows[0][0], row1_value: c.rows[0][1],
    row2_label: c.rows[1][0], row2_value: c.rows[1][1],
    row3_label: c.rows[2][0], row3_value: c.rows[2][1],
    row4_label: c.rows[3][0], row4_value: c.rows[3][1],
    row5_label: c.rows[4][0], row5_value: c.rows[4][1],
    note_title: c.noteTitle,
    note_body: c.noteBody || ' ',
    cta_label: c.ctaLabel,
    cta_url: c.ctaUrl,
    support_email: env('SUPPORT_EMAIL') || 'fashion@anniepetars.com',
    year: String(new Date().getFullYear())
  }

  const recipients = isAdmin
    ? env('ADMIN_NOTIFY_EMAILS').split(',').map((s) => s.trim()).filter(Boolean)
    : [r.email]

  const results = await Promise.allSettled(
    recipients.map((to) => sendTemplateEmail(to, tpl, c.subject, variables))
  )
  results.forEach((res, i) => {
    if (res.status === 'rejected') console.error('notify email threw', recipients[i], res.reason)
    else if (!res.value.ok) console.error('notify email failed', recipients[i], res.value.error)
  })

}