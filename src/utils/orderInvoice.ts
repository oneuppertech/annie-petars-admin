/* eslint-disable @typescript-eslint/no-explicit-any */
import { describeTimeline } from '@/utils/orders'
import type { OrderDetail } from '@/types/orders'

export type InvoiceData = OrderDetail & {
  refunded_kobo: number
  business: {
    name: string
    address: string | null
    email: string | null
    phone: string | null
    website: string | null
    footer_note: string | null
  }
  logo_data_url: string | null
  generated_at: string
  filename: string
}

export interface InvoiceOptions {
  /** true = full internal record (timeline, notes, stock, checks). false = customer copy. */
  internal?: boolean
}

/* ---------- pdfmake loader (works with 0.2.x and 0.3.x) ---------- */
let pdfMakeP: Promise<any> | null = null
function getPdfMake() {
  pdfMakeP ??= (async () => {
    const mod: any = await import('pdfmake/build/pdfmake')
    const fonts: any = await import('pdfmake/build/vfs_fonts')
    const pdfMake = mod.default ?? mod
    const f = fonts.default ?? fonts
    const vfs = f?.pdfMake?.vfs ?? f?.vfs ?? f
    if (typeof pdfMake.addVirtualFileSystem === 'function') pdfMake.addVirtualFileSystem(vfs)
    else pdfMake.vfs = vfs
    return pdfMake
  })()
  return pdfMakeP
}

/* ---------- formatting ---------- */
const money = (amount: unknown, currency = 'NGN') => {
  const code = String(currency || 'NGN').toUpperCase()

  const localeByCurrency: Record<string, string> = {
    NGN: 'en-NG',
    GBP: 'en-GB',
    USD: 'en-US',
    EUR: 'en-IE',
    CAD: 'en-CA',
    AUD: 'en-AU',
    GHS: 'en-GH',
    KES: 'en-KE',
    ZAR: 'en-ZA'
  }

  try {
    return new Intl.NumberFormat(localeByCurrency[code] || 'en', {
      style: 'currency',
      currency: code,
      minimumFractionDigits: 2,
      maximumFractionDigits: 2
    }).format(Number(amount ?? 0) / 100)
  } catch {
    return `${code} ${(Number(amount ?? 0) / 100).toFixed(2)}`
  }
}
const dt = (v?: string | null, withTime = true) =>
  v
    ? new Date(v).toLocaleString('en-NG', {
        timeZone: 'Africa/Lagos',
        day: '2-digit',
        month: 'short',
        year: 'numeric',
        ...(withTime ? { hour: '2-digit', minute: '2-digit' } : {})
      })
    : '—'

const label = (s?: string | null) =>
  s ? s.replace(/_/g, ' ').replace(/^\w/, (c) => c.toUpperCase()) : '—'

const TONE: Record<string, string> = {
  paid: '#15803d',
  delivered: '#15803d',
  shipped: '#1d4ed8',
  processing: '#b45309',
  ready_to_ship: '#b45309',
  pending_payment: '#b45309',
  unpaid: '#b45309',
  cancelled: '#b91c1c',
  refunded: '#b91c1c'
}

function imageSize(src: string): Promise<{ w: number; h: number }> {
  return new Promise((resolve) => {
    const img = new Image()
    img.onload = () => resolve({ w: img.naturalWidth, h: img.naturalHeight })
    img.onerror = () => resolve({ w: 1, h: 1 })
    img.src = src
  })
}

/* ---------- building blocks ---------- */
const H = (t: string) => ({ text: t.toUpperCase(), style: 'h2', margin: [0, 16, 0, 6] })

const kv = (rows: [string, any][]) => ({
  table: {
    widths: [120, '*'],
    body: rows.map(([k, v]) => [
      { text: k, style: 'muted' },
      typeof v === 'object' && v !== null ? v : { text: String(v ?? '—') }
    ])
  },
  layout: 'lightHorizontalLines'
})

const badge = (value: string) => ({
  text: label(value),
  bold: true,
  color: TONE[value] ?? '#475569'
})

export async function buildInvoiceDoc(inv: InvoiceData, opts: InvoiceOptions = {}) {
  const internal = opts.internal ?? true
  const { order: o, payments, timeline, reconciliation: r, business: biz } = inv
  const currency = String(o.currency || 'NGN').toUpperCase()
  const a: any = o.shipping_address ?? {}
  const logo = inv.logo_data_url
  const size = logo ? await imageSize(logo) : null
  const pickup = o.delivery_method === 'pickup'

  const netReceived = Number(r.paid_kobo) - Number(inv.refunded_kobo || 0)
  const outstanding = Math.max(Number(o.total_kobo) - Number(r.paid_kobo), 0)

  /* ---- header ---- */
  const header = {
    columns: [
      {
        width: '*',
        stack: [
          logo
            ? { image: logo, fit: [90, 60], margin: [0, 0, 0, 6] }
            : { text: biz.name, fontSize: 18, bold: true },
          { text: biz.name, bold: true, fontSize: 11 },
          ...[biz.address, biz.email, biz.phone, biz.website]
            .filter(Boolean)
            .map((t) => ({ text: t as string, style: 'muted' }))
        ]
      },
      {
        width: 'auto',
        alignment: 'right',
        stack: [
          { text: 'INVOICE', fontSize: 24, bold: true, color: '#6d28d9' },
          { text: o.order_number, bold: true, margin: [0, 2, 0, 0] },
          { text: `Placed: ${dt(o.placed_at)}`, style: 'muted' },
          { text: `Issued: ${dt(inv.generated_at)}`, style: 'muted' },
          { text: [{ text: 'Order: ', style: 'muted' }, badge(o.status)], margin: [0, 4, 0, 0] },
          { text: [{ text: 'Payment: ', style: 'muted' }, badge(o.payment_status)] }
        ]
      }
    ]
  }

  /* ---- customer / shipping ---- */
  const addrLines = [
    a.recipient_name,
    a.address_line1,
    a.address_line2,
    [a.city, a.state_region, a.postal_code].filter(Boolean).join(', '),
    a.country_code,
    a.phone
  ].filter(Boolean)

  const parties = {
    columns: [
      {
        width: '*',
        stack: [
          H('Billed to'),
          { text: o.customer?.full_name ?? a.recipient_name ?? 'Guest checkout', bold: true },
          { text: o.email },
          { text: o.phone || '' },
          ...(internal
            ? [
                {
                  text: o.customer
                    ? `Registered customer · ${o.customer_order_count} order(s) in total`
                    : 'Guest checkout',
                  style: 'muted'
                }
              ]
            : [])
        ]
      },
      {
        width: '*',
        stack: [
          H(pickup ? 'Pickup' : 'Ship to'),
          ...(pickup
            ? [{ text: 'Customer pickup' }]
            : addrLines.length
              ? addrLines.map((l) => ({ text: String(l) }))
              : [{ text: 'No address on file', style: 'muted' }])
        ]
      }
    ],
    columnGap: 24
  }

  /* ---- fulfilment ---- */
  const fulfilment = [
    H('Order & fulfilment'),
    kv([
      ['Order number', o.order_number],
      ['Order status', badge(o.status)],
      ['Payment status', badge(o.payment_status)],
      ['Delivery method', pickup ? 'Customer pickup' : 'Delivery'],
      ...(pickup
        ? []
        : ([
            ['Shipping provider', o.shipping_provider || '—'],
            ['Tracking number', o.tracking_number || '—'],
            [
              'Tracking link',
              o.tracking_url
                ? { text: o.tracking_url, link: o.tracking_url, color: '#1d4ed8' }
                : '—'
            ]
          ] as [string, any][])),
      ['Estimated delivery', dt(o.estimated_delivery_date, false)],
      ['Shipped', dt(o.shipped_at)],
      ['Delivered', dt(o.delivered_at)],
      ['Paid at', dt((o as any).paid_at)],
      ['Currency', o.currency ?? 'NGN']
    ])
  ]

  /* ---- items ---- */
  const itemHead = ['Item', 'Qty', 'Unit price', 'Total']
  if (internal) itemHead.splice(2, 0, 'In stock')
  const items = [
    H('Items'),
    {
      table: {
        headerRows: 1,
        widths: internal ? ['*', 30, 45, 85, 85] : ['*', 30, 90, 90],
        body: [
          itemHead.map((t, i) => ({
            text: t,
            style: 'th',
            alignment: i === 0 ? 'left' : 'right'
          })),
          ...(o.items as any[]).map((i) => {
            const variant = [i.size, i.colour].filter(Boolean).join(' / ')
            const row: any[] = [
              {
                stack: [
                  { text: i.product_name, bold: true },
                  {
                    text: [variant, i.sku].filter(Boolean).join(' · ') || 'No variant',
                    style: 'muted'
                  }
                ]
              },
              { text: String(i.quantity), alignment: 'right' },
              { text: money(i.unit_price_kobo, currency), alignment: 'right' },
              { text: money(i.line_total_kobo, currency), alignment: 'right', bold: true }
            ]
            if (internal)
              row.splice(2, 0, {
                text:
                  i.current_stock == null
                    ? '—'
                    : `${i.current_stock}${i.variant_active === false ? ' (inactive)' : ''}`,
                alignment: 'right',
                style: 'muted'
              })
            return row
          })
        ]
      },
      layout: 'lightHorizontalLines'
    }
  ]

  /* ---- totals ---- */
  const totalRow = (k: string, v: string, bold = false, color?: string) => [
    { text: k, alignment: 'right', bold, color },
    { text: v, alignment: 'right', bold, color }
  ]
  const totals = {
    margin: [0, 10, 0, 0],
    columns: [
      { width: '*', text: '' },
      {
        width: 260,
        table: {
          widths: ['*', 110],
          body: [
            totalRow('Subtotal', money(o.subtotal_kobo, currency)),
            totalRow('Shipping', money(o.shipping_kobo, currency)),
            ...(Number(o.discount_kobo) ? [totalRow('Discount', `-${money(o.discount_kobo, currency)}`)] : []),
            totalRow('Order total', money(o.total_kobo, currency), true),
            totalRow('Amount paid', money(r.paid_kobo, currency)),
            ...(Number(inv.refunded_kobo) > 0
              ? [
                  totalRow('Refunded', `-${money(inv.refunded_kobo, currency)}`, false, '#b91c1c'),
                  totalRow('Net received', money(netReceived, currency), true)
                ]
              : []),
            totalRow(
              'Balance due',
              money(['cancelled', 'refunded'].includes(o.status) ? 0 : outstanding, currency),
              true,
              outstanding > 0 && !['cancelled', 'refunded'].includes(o.status)
                ? '#b91c1c'
                : '#15803d'
            )
          ]
        },
        layout: 'lightHorizontalLines'
      }
    ]
  }

  /* ---- payments ---- */
  const paymentsBlock = [
    H('Payments'),
    (payments as any[]).length
      ? {
          table: {
            headerRows: 1,
            widths: ['*', '*', 80, 50, 80],
            body: [
              ['Method', 'Reference', 'Date', 'Status', 'Amount'].map((t, i) => ({
                text: t,
                style: 'th',
                alignment: i === 4 ? 'right' : 'left'
              })),
              ...(payments as any[]).map((p) => [
                { text: label(String(p.provider).replace('manual_', 'manual ')) },
                { text: p.provider_reference || '—', fontSize: 8 },
                { text: dt(p.verified_at ?? p.created_at) , fontSize: 8 },
                badge(p.status),
                { text: money(p.amount_kobo, currency), alignment: 'right' }
              ])
            ]
          },
          layout: 'lightHorizontalLines'
        }
      : { text: 'No payments recorded.', style: 'muted' }
  ]

  /* ---- notes ---- */
  const notes = [
    ...(o.customer_note ? [H('Customer note'), { text: o.customer_note }] : []),
    ...(internal && o.internal_note ? [H('Internal note'), { text: o.internal_note }] : [])
  ]

  /* ---- internal-only: checks + timeline ---- */
  const internalBlocks = internal
    ? [
        H('Reconciliation'),
        kv([
          ['Line items total', money(r.items_total_kobo, currency)],
          ['Subtotal matches items', r.subtotal_matches_items ? 'Yes' : 'NO — mismatch'],
          ['Total = subtotal + shipping − discount', r.total_matches_parts ? 'Yes' : 'NO — mismatch'],
          [
            'Payments match total',
            r.payment_matches_total ? 'Yes' : `NO — received ${money(r.paid_kobo, currency)}`
          ],
          ['Stock reserved', inv.flags?.stock_held ? 'Yes' : 'No']
        ]),
        H('Order timeline'),
        (timeline as any[]).length
          ? {
              table: {
                headerRows: 1,
                widths: [85, '*', 90],
                body: [
                  ['Date', 'Event', 'By'].map((t) => ({ text: t, style: 'th' })),
                  ...(timeline as any[]).map((t) => {
                    let ev = t.action
                    try {
                      ev = describeTimeline(t, currency) || t.action
                    } catch {
                      /* fall back to raw action */
                    }
                    return [
                      { text: dt(t.created_at), fontSize: 8 },
                      { text: String(ev), fontSize: 9 },
                      { text: t.actor_name || (t.actor_user_id ? 'Staff' : 'System'), fontSize: 8 }
                    ]
                  })
                ]
              },
              layout: 'lightHorizontalLines'
            }
          : { text: 'No activity yet.', style: 'muted' }
      ]
    : []

  return {
    pageSize: 'A4',
    pageMargins: [40, 40, 40, 55],
    info: { title: `Invoice ${o.order_number}`, author: biz.name },
    defaultStyle: { fontSize: 10, color: '#0f172a' },
    styles: {
      h2: { fontSize: 9, bold: true, color: '#6d28d9', characterSpacing: 0.8 },
      th: { fontSize: 8, bold: true, color: '#475569', fillColor: '#f1f5f9' },
      muted: { color: '#64748b', fontSize: 9 }
    },
    background: (_page: number, ps: { width: number; height: number }) => {
      if (!logo || !size) return null
      const box = Math.min(ps.width, ps.height) * 0.62
      const scale = box / Math.max(size.w, size.h)
      const w = size.w * scale
      const h = size.h * scale
      return {
        image: logo,
        width: w,
        height: h,
        opacity: 0.06,
        absolutePosition: { x: (ps.width - w) / 2, y: (ps.height - h) / 2 }
      }
    },
    footer: (page: number, count: number) => ({
      margin: [40, 0, 40, 0],
      columns: [
        { text: biz.footer_note ?? '', style: 'muted', width: '*' },
        { text: `${o.order_number} · Page ${page} of ${count}`, style: 'muted', alignment: 'right' }
      ]
    }),
    content: [
      header,
      parties,
      ...fulfilment,
      ...items,
      totals,
      ...paymentsBlock,
      ...notes,
      ...internalBlocks
    ]
  }
}

export async function downloadInvoice(inv: InvoiceData, opts: InvoiceOptions = {}) {
  const [pdfMake, doc] = await Promise.all([getPdfMake(), buildInvoiceDoc(inv, opts)])
  const name = opts.internal === false ? inv.filename.replace('.pdf', '-customer.pdf') : inv.filename
  await pdfMake.createPdf(doc).download(name)
}