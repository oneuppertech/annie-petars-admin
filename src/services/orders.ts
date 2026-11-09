import ApiService from '@/services/api' // <- adjust to wherever your axios wrapper lives
import type {
  BulkStatusResponse,
  CreateOrderInput,
  CustomerOption,
  ExportResponse,
  InvoiceResponse,
  OrderDetail,
  OrderListParams,
  OrderListResponse,
  OrderStats,
  StatusInput,
  VariantOption,
  Address
} from '@/types/orders'

const ENDPOINT = '/admin-orders' // <- supabase/functions/<name>

type Params = Record<string, unknown>
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Any = any

const clean = (p: Params) =>
  Object.fromEntries(Object.entries(p).filter(([, v]) => v !== undefined && v !== null && v !== ''))

/** Some gateways wrap the payload as { data: {...} }; unwrap it when it's an object. */
const unwrap = (r: Any): Any =>
  r &&
  typeof r === 'object' &&
  !Array.isArray(r) &&
  r.data &&
  typeof r.data === 'object' &&
  !Array.isArray(r.data)
    ? r.data
    : r

const read = async (resource: string, params: Params = {}): Promise<Any> =>
  unwrap(await ApiService.get(ENDPOINT, { params: clean({ resource, ...params }) }))

const act = async (action: string, body: Params): Promise<Any> =>
  unwrap(await ApiService.post(ENDPOINT, { action, ...body }))

const detail = async (action: string, body: Params) => {
  const r = await act(action, body)
  if (!r?.order) throw new Error('Unexpected response from the orders service')
  return r as OrderDetail
}

export const OrdersService = {
  /* ---- reads (always return a safe shape, even on empty/unexpected responses) ---- */
  async list(params: OrderListParams = {}): Promise<OrderListResponse> {
  const r = await read('list', { ...params })

  // Support both API response structures:
  // { orders: [], total: 10 }
  // { data: [...] }
  // [...]

  const records = Array.isArray(r)
    ? r
    : Array.isArray(r?.orders)
      ? r.orders
      : Array.isArray(r?.data)
        ? r.data
        : []

  const mappedOrders = records.map((order: Any) => {
    const items = Array.isArray(order.items) ? order.items : []

    return {
      ...order,

      item_count: order.item_count ??
        items.reduce(
          (sum: number, item: Any) => sum + Number(item.quantity || 0),
          0
        ),

      items_preview: order.items_preview ??
        items.map((item: Any) => item.product_name || item.sku).filter(Boolean),

      customer: order.customer ?? null
    }
  })

  return {
    total: Number(r?.total ?? r?.count ?? mappedOrders.length),
    page: Number(r?.page) || 1,
    limit: Number(r?.limit) || params.limit || 20,
    orders: mappedOrders
  }
},
  async get(id: string): Promise<OrderDetail> {
    const r = await read('order', { id })
    if (!r?.order) throw new Error('Order not found')
    return r as OrderDetail
  },
  async stats(params: { from?: string; to?: string } = {}): Promise<OrderStats | null> {
    const r = await read('stats', params)
    return r?.totals ? (r as OrderStats) : null
  },
  invoice: (id: string) => read('invoice', { id }) as Promise<InvoiceResponse>,
  exportCsv: (params: OrderListParams = {}) =>
    read('export', { ...params }) as Promise<ExportResponse>,
  async variants(q: string) {
    return ((await read('variants', { q }))?.variants ?? []) as VariantOption[]
  },
  async customers(q: string) {
    return ((await read('customers', { q }))?.customers ?? []) as CustomerOption[]
  },

  /* ---- writes (return the refreshed OrderDetail unless noted) ---- */
  createOrder: (input: CreateOrderInput) => detail('create_order', { ...input }),
  updateStatus: (id: string, input: StatusInput) => detail('update_status', { id, ...input }),
  bulkStatus: (
    ids: string[],
    status: string,
    extra: { shipping_provider?: string; note?: string; restock?: boolean } = {}
  ) => act('bulk_status', { ids, status, ...extra }) as Promise<BulkStatusResponse>,
  updateShipping: (
    id: string,
    v: { shipping_provider?: string | null; tracking_number?: string | null }
  ) => detail('update_shipping', { id, ...v }),
  updateAddress: (id: string, v: { shipping_address?: Address; billing_address?: Address }) =>
    detail('update_address', { id, ...v }),
  updateContact: (id: string, v: { email?: string; phone?: string }) =>
    detail('update_contact', { id, ...v }),
  updateNotes: (id: string, v: { internal_note?: string; customer_note?: string }) =>
    detail('update_notes', { id, ...v }),
  addNote: (id: string, note: string) => detail('add_note', { id, note }),
  attachCustomer: (id: string, customer_id: string | null) =>
    detail('attach_customer', { id, customer_id }),
  updateTotals: (id: string, v: { shipping_kobo?: number; discount_kobo?: number }) =>
    detail('update_totals', { id, ...v }),
  editItems: (
    id: string,
    items: { variant_id: string; quantity: number; unit_price_kobo?: number }[]
  ) => detail('edit_items', { id, items }),
  recordPayment: (
    id: string,
    v: { type: string; reference: string; amount_kobo?: number; note?: string }
  ) => detail('record_payment', { id, ...v }),
  refund: (
    id: string,
    v: { reason: string; amount_kobo?: number; reference?: string; restock?: boolean }
  ) => detail('refund', { id, ...v })
}

/** Saves the CSV returned by `exportCsv` as a file in the browser. */
export function downloadCsv(res: ExportResponse) {
  const url = URL.createObjectURL(new Blob([res.csv], { type: 'text/csv;charset=utf-8' }))
  const a = document.createElement('a')
  a.href = url
  a.download = res.filename
  a.click()
  URL.revokeObjectURL(url)
}
