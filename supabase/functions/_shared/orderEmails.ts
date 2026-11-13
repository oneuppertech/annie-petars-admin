// _shared/orderEmails.ts
// Five transactional emails (placed, shipped, delivered, cancelled, returned)
// rendered from one table-based, inline-styled layout (safe for Gmail/Outlook/Apple Mail).
//
// Assets (upload to a PUBLIC storage bucket, e.g. "email-assets", folder "email/"):
//   logo.png (≈ 160x48), badge-placed.png, badge-shipped.png, badge-delivered.png,
//   badge-cancelled.png, badge-returned.png (each 240x240, shown at 120x120)
// Set EMAIL_ASSETS_URL to the folder's public URL, e.g.
//   https://<project>.supabase.co/storage/v1/object/public/email-assets/email

export type OrderEvent = 'placed' | 'shipped' | 'delivered' | 'cancelled' | 'returned'

export interface EmailItem {
  name: string
  image?: string | null // absolute public URL
  size?: string | null
  colour?: string | null
  qty: number
  unitKobo: number
  lineKobo: number
}

export interface OrderEmailData {
  orderNumber: string
  customerName: string
  items: EmailItem[]
  subtotalKobo: number
  shippingKobo: number
  discountKobo: number
  totalKobo: number
  paymentReference?: string | null
  paidAt?: string | null
  shippingAddress?: { line1?: string; city?: string; state?: string; phone?: string }
  trackingNumber?: string | null
  shippingProvider?: string | null
  trackUrl?: string | null // your tracking page, if any
  reason?: string | null // shown on cancelled / returned
}

/* ---------- Theme (matches the shop) ---------- */
const T = {
  ink: '#2A1B16',
  body: '#5A413A',
  muted: '#8A7168',
  accent: '#E2784A',
  accentDark: '#C4623A',
  soft: '#FFE6D6',
  cream: '#FFF7F1',
  line: '#EADBD2',
  font: "'Manrope', 'Helvetica Neue', Helvetica, Arial, sans-serif",
  display: "'Fraunces', Georgia, 'Times New Roman', serif"
}

const env = (k: string, d = '') => Deno.env.get(k) || d
const ASSETS = () => env('EMAIL_ASSETS_URL').replace(/\/$/, '')
const SHOP_URL = () => env('SHOP_URL', 'https://shop.anniepetars.com')
const WHATSAPP = () => env('WHATSAPP_URL', 'https://wa.me/2348084903580')
const LOGO_URL = () =>
  env(
    'EMAIL_LOGO_URL',
    'https://gqomllacgzkdecqsdhwh.supabase.co/storage/v1/object/public/email-assets/annie-peters-logo.png'
  )

const esc = (s: unknown) =>
  String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')

export const naira = (kobo: number) =>
  new Intl.NumberFormat('en-NG', {
    style: 'currency',
    currency: 'NGN',
    minimumFractionDigits: 2
  }).format((Number(kobo) || 0) / 100)

/* ---------- Copy per event ---------- */
type StepState = 'done' | 'current' | 'todo'

const TRACKER: Partial<Record<OrderEvent, [StepState, StepState, StepState]>> = {
  placed: ['done', 'current', 'todo'],
  shipped: ['done', 'done', 'current'],
  delivered: ['done', 'done', 'done']
}

function copy(event: OrderEvent, d: OrderEmailData, first: string) {
  const carrier = [d.shippingProvider, d.trackingNumber && `Tracking: ${d.trackingNumber}`]
    .filter(Boolean)
    .join(' · ')
  const trackLink = d.trackUrl || `${WHATSAPP()}?text=${encodeURIComponent(`Hi, I'd like an update on order ${d.orderNumber}`)}`
  switch (event) {
    case 'placed':
      return {
        subject: `Order ${d.orderNumber} confirmed`,
        title: `Hi ${first}, your order has been successfully received!`,
        sub: 'Thank you for shopping with AnniePetars. We are getting your order ready.',
        heading: 'Your order',
        cta: { label: 'TRACK ORDER', url: trackLink }
      }
    case 'shipped':
      return {
        subject: `Order ${d.orderNumber} is on its way`,
        title: `Good news ${first}, your order is on its way!`,
        sub: carrier || 'Your package has left us and is headed to you.',
        heading: 'Your order',
        cta: { label: 'TRACK SHIPMENT', url: trackLink }
      }
    case 'delivered':
      return {
        subject: `Order ${d.orderNumber} has been delivered`,
        title: `Hi ${first}, your order has been delivered!`,
        sub: 'We hope you love your new pieces. Tag us when you wear them.',
        heading: 'What we delivered',
        cta: { label: 'SHOP AGAIN', url: SHOP_URL() }
      }
    case 'cancelled':
      return {
        subject: `Order ${d.orderNumber} has been cancelled`,
        title: `Hi ${first}, your order has been cancelled.`,
        sub:
          d.reason ||
          'If you were charged, we will be in touch about your refund. Questions? Just reply to this email.',
        heading: 'Cancelled items',
        cta: { label: 'CONTINUE SHOPPING', url: SHOP_URL() }
      }
    case 'returned':
      return {
        subject: `We received your return for ${d.orderNumber}`,
        title: `Hi ${first}, we have received your return.`,
        sub:
          d.reason ||
          'Our team is inspecting the items. We will confirm your refund or exchange shortly.',
        heading: 'Returned items',
        cta: { label: 'SHOP AGAIN', url: SHOP_URL() }
      }
  }
}

/* ---------- Building blocks ---------- */
function stepCell(label: string, st: StepState, n: number, first: boolean, last: boolean) {
  const reached = st !== 'todo'
  const leftC = first ? 'transparent' : reached ? T.accent : T.line
  const rightC = last ? 'transparent' : st === 'done' ? T.accent : T.line
  const circle =
    st === 'done'
      ? `<td align="center" bgcolor="${T.accent}" style="width:28px;height:28px;border-radius:14px;color:#ffffff;font-size:14px;line-height:28px;font-weight:700;">&#10003;</td>`
      : `<td align="center" bgcolor="#ffffff" style="width:24px;height:24px;border-radius:14px;border:2px solid ${
          st === 'current' ? T.accent : T.line
        };color:${st === 'current' ? T.accent : T.muted};font-size:12px;line-height:24px;font-weight:700;">${n}</td>`
  const pill = {
    done: { bg: T.soft, fg: T.accentDark, t: 'Completed' },
    current: { bg: '#FFF1D6', fg: '#8A5A00', t: 'In progress' },
    todo: { bg: '#F1F1F1', fg: T.muted, t: 'Pending' }
  }[st]
  const line = (c: string) =>
    `<td valign="middle" style="font-size:0;line-height:0;"><div style="height:2px;background:${c};">&nbsp;</div></td>`
  return `
  <td width="33%" align="center" valign="top" style="padding:0;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr>
      ${line(leftC)}<td width="32" align="center" style="padding:0;"><table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr>${circle}</tr></table></td>${line(rightC)}
    </tr></table>
    <div style="font-size:10px;letter-spacing:1px;color:${T.muted};text-transform:uppercase;margin-top:12px;">Step ${n}</div>
    <div style="font-size:15px;font-weight:600;color:${T.ink};margin-top:2px;">${label}</div>
    <div style="margin-top:8px;"><span style="display:inline-block;background:${pill.bg};color:${pill.fg};font-size:10px;font-weight:700;padding:4px 10px;border-radius:10px;">${pill.t}</span></div>
  </td>`
}

function tracker(states: [StepState, StepState, StepState]) {
  const labels = ['Ordered', 'Shipped', 'Delivered']
  return `
  <tr><td style="padding:8px 24px 0;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr>
      ${labels.map((l, i) => stepCell(l, states[i], i + 1, i === 0, i === 2)).join('')}
    </tr></table>
  </td></tr>`
}

function itemRow(i: EmailItem, orderNumber: string, idx: number) {
  const opts = [i.size, i.colour].filter(Boolean).join(' · ')
  const img = i.image
    ? `<img src="${esc(i.image)}" width="72" height="72" alt="${esc(i.name)}" style="display:block;width:72px;height:72px;object-fit:cover;border-radius:10px;background:${T.soft};" />`
    : `<div style="width:72px;height:72px;border-radius:10px;background:${T.soft};"></div>`
  return `
  <tr>
    <td valign="top" width="88" style="padding:14px 0;border-bottom:1px solid ${T.line};">${img}</td>
    <td valign="top" style="padding:14px 12px;border-bottom:1px solid ${T.line};">
      <div style="font-size:15px;font-weight:700;color:${T.ink};line-height:1.3;">${esc(i.name)}</div>
      ${opts ? `<div style="font-size:12px;color:${T.body};margin-top:4px;">${esc(opts)}</div>` : ''}
      <div style="font-size:12px;color:${T.body};margin-top:4px;">Qty ${i.qty} × ${naira(i.unitKobo)}</div>
      ${idx === 0 ? `<div style="font-size:11px;color:${T.muted};margin-top:6px;">Order #${esc(orderNumber)}</div>` : ''}
    </td>
    <td valign="top" align="right" style="padding:14px 0;border-bottom:1px solid ${T.line};font-size:14px;font-weight:700;color:${T.ink};white-space:nowrap;">${naira(i.lineKobo)}</td>
  </tr>`
}

function sumRow(label: string, value: string, strong = false) {
  const s = strong
    ? `font-size:16px;font-weight:700;color:${T.ink};padding:12px 0 0;border-top:1px solid ${T.line};`
    : `font-size:13px;color:${T.body};padding:6px 0;`
  return `<tr><td style="${s}">${label}</td><td align="right" style="${s}">${value}</td></tr>`
}

function addressBlock(a?: OrderEmailData['shippingAddress']) {
  if (!a) return ''
  const lines = [a.line1, [a.city, a.state].filter(Boolean).join(', '), a.phone].filter(Boolean)
  if (!lines.length) return ''
  return `
  <tr><td style="padding:20px 24px 0;">
    <div style="font-size:11px;letter-spacing:1px;text-transform:uppercase;color:${T.muted};">Delivery address</div>
    <div style="font-size:13px;color:${T.body};line-height:1.6;margin-top:6px;">${lines.map(esc).join('<br/>')}</div>
  </td></tr>`
}

/* ---------- Public API ---------- */
export function renderOrderEmail(event: OrderEvent, d: OrderEmailData) {
  const first = esc((d.customerName || 'there').trim().split(/\s+/)[0])
  const c = copy(event, d, first)
  const states = TRACKER[event]
  const refunded = event === 'cancelled' || event === 'returned'
  const assets = ASSETS()

  const html = `<!doctype html>
<html lang="en"><head>
<meta charset="utf-8"/><meta name="viewport" content="width=device-width,initial-scale=1"/>
<meta name="color-scheme" content="light"/><title>${esc(c.subject)}</title>
</head>
<body style="margin:0;padding:0;background:${T.cream};">
<div style="display:none;max-height:0;overflow:hidden;opacity:0;">${esc(c.sub)}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="${T.cream}" style="background:${T.cream};">
<tr><td align="center" style="padding:24px 12px;">
  <table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0" style="width:100%;max-width:600px;background:#ffffff;border-radius:16px;font-family:${T.font};">

    <tr><td align="center" style="padding:28px 24px 0;">
      <img src="${assets}/logo.png" height="40" alt="AnniePetars" style="display:block;height:40px;border:0;" />
    </td></tr>

    <tr><td align="center" style="padding:24px 24px 0;">
      <img
  src="${LOGO_URL()}"
  width="160"
  height="48"
  alt="AnniePetars"
  style="display:block;width:160px;height:auto;max-width:100%;border:0;outline:none;text-decoration:none;"
/>
    </td></tr>

    <tr><td align="center" style="padding:24px 28px 0;">
      <h1 style="margin:0;font-family:${T.font};font-size:28px;line-height:1.25;font-weight:800;color:${T.ink};">${c.title}</h1>
      <p style="margin:12px 0 0;font-size:15px;line-height:1.6;color:${T.body};">${esc(c.sub)}</p>
    </td></tr>

    ${
      states
        ? `<tr><td align="center" style="padding:28px 24px 0;"><div style="font-family:${T.display};font-size:20px;color:${T.ink};">Where your order is</div></td></tr>${tracker(states)}`
        : ''
    }

    <tr><td align="center" style="padding:28px 24px 8px;">
      <a href="${esc(c.cta.url)}" style="display:inline-block;background:${T.accent};color:#ffffff;font-size:13px;font-weight:700;letter-spacing:.5px;text-decoration:none;padding:14px 28px;border-radius:10px;">${c.cta.label}</a>
    </td></tr>

    <tr><td style="padding:24px 24px 0;"><div style="border-top:1px dashed ${T.line};font-size:0;line-height:0;">&nbsp;</div></td></tr>

    <tr><td style="padding:20px 24px 0;">
      <div style="font-family:${T.display};font-size:20px;color:${T.ink};">${c.heading}</div>
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin-top:8px;">
        ${d.items.map((i, n) => itemRow(i, d.orderNumber, n)).join('')}
      </table>
    </td></tr>

    <tr><td style="padding:16px 24px 0;">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
        ${sumRow('Items subtotal', naira(d.subtotalKobo))}
        ${sumRow('Delivery fee', naira(d.shippingKobo))}
        ${d.discountKobo > 0 ? sumRow('Discount', `-${naira(d.discountKobo)}`) : ''}
        ${sumRow(refunded ? 'Order total' : event === 'placed' ? 'Total paid' : 'Total', naira(d.totalKobo), true)}
      </table>
    </td></tr>

    ${
      d.paymentReference
        ? `<tr><td style="padding:14px 24px 0;font-size:12px;color:${T.muted};line-height:1.6;">
            Payment reference: ${esc(d.paymentReference)}${d.paidAt ? ` · ${esc(new Date(d.paidAt).toLocaleDateString('en-NG', { day: 'numeric', month: 'short', year: 'numeric' }))}` : ''}
          </td></tr>`
        : ''
    }

    ${addressBlock(d.shippingAddress)}

    <tr><td style="padding:28px 24px 28px;">
      <div style="background:${T.cream};border-radius:12px;padding:16px;text-align:center;font-size:13px;color:${T.body};line-height:1.6;">
        Need help with order ${esc(d.orderNumber)}? <a href="${esc(WHATSAPP())}" style="color:${T.accentDark};font-weight:700;">Message us on WhatsApp</a>.
      </div>
      <p style="margin:18px 0 0;text-align:center;font-size:11px;color:${T.muted};">&copy; ${new Date().getFullYear()} AnniePetars. All rights reserved.</p>
    </td></tr>

  </table>
</td></tr></table>
</body></html>`

  const text = [
    c.title.replace(/&[^;]+;/g, ''),
    c.sub,
    '',
    `Order ${d.orderNumber}`,
    ...d.items.map((i) => `- ${i.name} x${i.qty}  ${naira(i.lineKobo)}`),
    '',
    `Subtotal: ${naira(d.subtotalKobo)}`,
    `Delivery: ${naira(d.shippingKobo)}`,
    ...(d.discountKobo > 0 ? [`Discount: -${naira(d.discountKobo)}`] : []),
    `Total: ${naira(d.totalKobo)}`
  ].join('\n')

  return { subject: c.subject, html, text }
}

// Short SMS copy (Termii) for each event
export function orderSms(event: OrderEvent, d: OrderEmailData) {
  const first = (d.customerName || '').trim().split(/\s+/)[0] || 'there'
  switch (event) {
    case 'placed':
      return `Hi ${first}, your AnniePetars order ${d.orderNumber} (${naira(d.totalKobo)}) is confirmed. We'll update you when it ships.`
    case 'shipped':
      return `Hi ${first}, order ${d.orderNumber} is on its way.${d.trackingNumber ? ` Tracking: ${d.trackingNumber}.` : ''}`
    case 'delivered':
      return `Hi ${first}, order ${d.orderNumber} has been delivered. Enjoy! - AnniePetars`
    case 'cancelled':
      return `Hi ${first}, order ${d.orderNumber} has been cancelled. Questions? Message us on WhatsApp.`
    case 'returned':
      return `Hi ${first}, we've received your return for order ${d.orderNumber}. We'll confirm next steps shortly.`
  }
}

/* ---------- Termii template mode ---------- */
// The static HTML in /termii-templates uses {{variables}}. This builds the values
// for the Termii "send-email" call. items_html / discount_row_html are HTML fragments.
export function orderTemplateVars(event: OrderEvent, d: OrderEmailData): Record<string, string> {
  const a = d.shippingAddress ?? {}
  return {
    first_name: (d.customerName || 'there').trim().split(/\s+/)[0],
    order_number: d.orderNumber,
    items_html: d.items.map((i, n) => itemRow(i, d.orderNumber, n)).join(''),
    subtotal: naira(d.subtotalKobo),
    delivery_fee: naira(d.shippingKobo),
    discount_row_html: d.discountKobo > 0 ? sumRow('Discount', `-${naira(d.discountKobo)}`) : '',
    total: naira(d.totalKobo),
    payment_reference: d.paymentReference || d.orderNumber,
    payment_date: d.paidAt
      ? new Date(d.paidAt).toLocaleDateString('en-NG', { day: 'numeric', month: 'short', year: 'numeric' })
      : '',
    address: [a.line1, [a.city, a.state].filter(Boolean).join(', '), a.phone].filter(Boolean).map(esc).join('<br/>'),
    tracking_info: [d.shippingProvider, d.trackingNumber && `Tracking: ${d.trackingNumber}`].filter(Boolean).join(' · ') ||
      'Your package has left us and is headed to you.',
    reason: d.reason || copy(event, { ...d, reason: null }, '').sub,
    cta_url: d.trackUrl || (event === 'placed' || event === 'shipped'
      ? `${WHATSAPP()}?text=${encodeURIComponent(`Hi, I'd like an update on order ${d.orderNumber}`)}`
      : SHOP_URL()),
    support_url: WHATSAPP(),
    assets_url: ASSETS(),
    current_year: String(new Date().getFullYear())
  }
}

export const orderSubject = (event: OrderEvent, d: OrderEmailData) => copy(event, d, '').subject