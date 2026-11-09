import type { InvoiceResponse } from '@/types/orders'
import { formatAddress, formatDate, formatNaira, humanize } from '@/utils/orders'

const esc = (v: unknown) =>
  String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!)

/** Opens a clean, print-ready invoice in a new window and triggers the print dialog. */
export function printInvoice(inv: InvoiceResponse) {
  const o = inv.order
  const b = inv.business ?? {}
  const lines = (a: Parameters<typeof formatAddress>[0]) => formatAddress(a).map(esc).join('<br>')

  const rows = o.items
    .map(
      (i) => `<tr>
        <td><strong>${esc(i.product_name)}</strong><br><span class="m">${esc([i.size, i.colour].filter(Boolean).join(' / '))}${i.sku ? ` · ${esc(i.sku)}` : ''}</span></td>
        <td class="r">${i.quantity}</td>
        <td class="r">${formatNaira(i.unit_price_kobo)}</td>
        <td class="r">${formatNaira(i.line_total_kobo)}</td></tr>`
    )
    .join('')

  const html = `<!doctype html><html><head><meta charset="utf-8"><title>Invoice ${esc(o.order_number)}</title>
  <style>
    *{box-sizing:border-box} body{font-family:Inter,system-ui,sans-serif;color:#2B2226;margin:0;padding:48px;font-size:13px}
    h1{font-size:22px;margin:0} .m{color:#7A7177;font-size:12px}
    .top{display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:32px}
    .tag{display:inline-block;background:#FDEEE6;color:#C8663F;padding:3px 10px;border-radius:4px;font-size:12px;font-weight:600;text-transform:capitalize}
    .cols{display:grid;grid-template-columns:1fr 1fr 1fr;gap:24px;margin-bottom:28px}
    .cols h4{margin:0 0 6px;font-size:11px;letter-spacing:.12em;text-transform:uppercase;color:#7A7177}
    table{width:100%;border-collapse:collapse} th{font-size:11px;letter-spacing:.08em;text-transform:uppercase;color:#7A7177;text-align:left;padding:10px 8px;border-bottom:1px solid #EFE8EA;background:#FFFDFD}
    td{padding:12px 8px;border-bottom:1px solid #EFE8EA;vertical-align:top} .r{text-align:right}
    .tot{margin-left:auto;margin-top:18px;width:280px} .tot div{display:flex;justify-content:space-between;padding:5px 0}
    .tot .g{border-top:2px solid #C8663F;margin-top:6px;padding-top:10px;font-size:16px;font-weight:700}
    .foot{margin-top:48px;text-align:center;color:#7A7177;font-size:12px}
    @media print{body{padding:24px}}
  </style></head><body>
    <div class="top">
      <div><h1>${esc(b.name || 'Invoice')}</h1>
        <div class="m">${[b.address, b.phone, b.email].filter(Boolean).map(esc).join('<br>')}</div></div>
      <div style="text-align:right"><h1>Invoice</h1>
        <div>${esc(o.order_number)}</div><div class="m">${formatDate(o.placed_at)}</div>
        <div style="margin-top:8px"><span class="tag">${esc(humanize(o.status))}</span> <span class="tag">${esc(humanize(o.payment_status))}</span></div></div>
    </div>
    <div class="cols">
      <div><h4>Billed to</h4>${esc(o.customer?.full_name || o.shipping_address?.recipient_name || 'Guest')}<br><span class="m">${esc(o.email)}${o.phone ? `<br>${esc(o.phone)}` : ''}</span></div>
      <div><h4>Ship to</h4>${lines(o.shipping_address)}</div>
      <div><h4>Shipping</h4>${esc(o.shipping_provider || '—')}${o.tracking_number ? `<br><span class="m">Tracking: ${esc(o.tracking_number)}</span>` : ''}</div>
    </div>
    <table><thead><tr><th>Item</th><th class="r">Qty</th><th class="r">Price</th><th class="r">Total</th></tr></thead><tbody>${rows}</tbody></table>
    <div class="tot">
      <div><span>Subtotal</span><span>${formatNaira(o.subtotal_kobo)}</span></div>
      <div><span>Shipping</span><span>${formatNaira(o.shipping_kobo)}</span></div>
      ${o.discount_kobo ? `<div><span>Discount</span><span>−${formatNaira(o.discount_kobo)}</span></div>` : ''}
      <div class="g"><span>Total</span><span>${formatNaira(o.total_kobo)}</span></div>
    </div>
    <div class="foot">Thank you for your order.</div>
  </body></html>`

  const w = window.open('', '_blank', 'width=900,height=1000')
  if (!w) throw new Error('Allow pop-ups for this site to print the invoice')
  w.document.open()
  w.document.write(html)
  w.document.close()
  w.focus()
  setTimeout(() => w.print(), 300)
}