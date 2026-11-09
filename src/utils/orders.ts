import type { OrderStatus, TimelineEntry } from '@/types/orders'

export const naira = (kobo: number | string | null | undefined, decimals = 2) =>
  new Intl.NumberFormat('en-NG', {
    style: 'currency',
    currency: 'NGN',
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals
  }).format((Number(kobo) || 0) / 100)

export const compactNaira = (kobo: number) =>
  '₦' + new Intl.NumberFormat('en-NG', { notation: 'compact', maximumFractionDigits: 1 }).format((Number(kobo) || 0) / 100)

export const initials = (n: string) =>
  (n || '?').split(/\s+/).slice(0, 2).map((w) => w[0]?.toUpperCase()).join('')

export function relTime(iso: string, nowMs = Date.now()) {
  const diff = (Date.parse(iso) - nowMs) / 1000
  const rtf = new Intl.RelativeTimeFormat('en', { numeric: 'auto' })
  const abs = Math.abs(diff)
  if (abs < 60) return 'just now'
  if (abs < 3600) return rtf.format(Math.round(diff / 60), 'minute')
  if (abs < 86400) return rtf.format(Math.round(diff / 3600), 'hour')
  return rtf.format(Math.round(diff / 86400), 'day')
}

export const fmtDate = (iso?: string | null) =>
  iso
    ? new Intl.DateTimeFormat('en-NG', {
        dateStyle: 'medium',
        timeStyle: 'short',
        timeZone: 'Africa/Lagos'
      }).format(new Date(iso))
    : '—'

export const STATUS_META: Record<OrderStatus, { label: string; tone: string }> = {
  pending_payment: { label: 'Pending payment', tone: 'amber' },
  paid: { label: 'Paid', tone: 'green' },
  processing: { label: 'Processing', tone: 'peach' },
  ready_to_ship: { label: 'Ready to ship', tone: 'violet' },
  shipped: { label: 'Shipped', tone: 'blue' },
  delivered: { label: 'Delivered', tone: 'green' },
  cancelled: { label: 'Cancelled', tone: 'grey' },
  refunded: { label: 'Refunded', tone: 'red' }
}

export const STATUS_OPTIONS = (Object.keys(STATUS_META) as OrderStatus[]).map((v) => ({
  value: v,
  title: STATUS_META[v].label
}))

export const statusMeta = (s: string) => STATUS_META[s as OrderStatus] ?? { label: s, tone: 'grey' }

export const paymentTone = (s: string) =>
  ({ paid: 'green', unpaid: 'amber', pending: 'amber', failed: 'red', refunded: 'red' })[s] ?? 'grey'

export const pill = (tone: string) => `pill pill-${tone}`

export const humanize = (s: string) => s.replace(/_/g, ' ').replace(/^\w/, (c) => c.toUpperCase())

/** One-line description of an audit-log entry for the timeline. */
export function describeTimeline(t: TimelineEntry): string {
  const m = t.metadata || {}
  switch (t.action) {
    case 'order.create':
      return `Order created (${naira(m.total_kobo)})`
    case 'order.status':
      return `Status: ${statusMeta(m.from).label} → ${statusMeta(m.to).label}${
        m.restocked ? ` · ${m.restocked} item(s) restocked` : ''
      }${m.note ? ` — ${m.note}` : ''}`
    case 'order.payment_recorded':
      return `Payment recorded (${humanize(m.type || 'manual')}, ref ${m.reference})`
    case 'order.refund':
      return `Refunded ${naira(m.amount_kobo)} — ${m.reason}`
    case 'order.partial_refund':
      return `Partial refund of ${naira(m.amount_kobo)} — ${m.reason}`
    case 'order.restock':
      return `Stock returned (${m.items} line(s))`
    case 'order.shipping':
      return `Shipping updated: ${m.to?.shipping_provider ?? m.to?.provider ?? ''} ${
        m.to?.tracking_number ?? ''
      }`.trim()
    case 'order.address':
      return 'Address updated'
    case 'order.contact':
      return 'Contact details updated'
    case 'order.notes':
      return 'Notes updated'
    case 'order.items':
      return `Items edited (${m.items} line(s), ${naira(m.total_kobo)})`
    case 'order.totals':
      return `Amounts changed → ${naira(m.to?.total)}`
    case 'order.customer':
      return m.customer_id ? 'Customer attached' : 'Customer detached'
    case 'order.note':
      return m.note
    case 'order.bulk_status':
      return `Bulk update to ${statusMeta(m.status).label}`
    default:
      return humanize(t.action.replace('order.', ''))
  }
}