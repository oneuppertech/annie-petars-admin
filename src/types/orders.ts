export type OrderStatus =
  | 'pending_payment'
  | 'paid'
  | 'processing'
  | 'ready_to_ship'
  | 'shipped'
  | 'delivered'
  | 'cancelled'
  | 'refunded'

export interface Address {
  recipient_name?: string
  phone?: string
  address_line1?: string
  address_line2?: string
  city?: string
  state_region?: string
  postal_code?: string
  country_code?: string
  [key: string]: unknown
}

/* ---------- filters / list ---------- */
export interface OrderFilters {
  q: string
  status: string
  payment_status: string
  from: string
  to: string
  provider: string
  sort: string
  dir: 'asc' | 'desc'
}

export interface OrderListParams extends Partial<OrderFilters> {
  page?: number
  limit?: number
  customer_id?: string
  guest?: boolean
  has_tracking?: boolean
  min_total?: number
  max_total?: number
}

export interface OrderListItem {
  id: string
  order_number: string
  customer_id: string | null
  email: string
  phone: string | null
  status: OrderStatus
  payment_status: string
  currency: string
  subtotal_kobo: number
  shipping_kobo: number
  discount_kobo: number
  total_kobo: number
  tracking_number: string | null
  shipping_provider: string | null
  placed_at: string
  updated_at: string
  customer: { id: string; full_name: string } | null
  item_count: number
  items_preview: string[]
  allowed_next_statuses: OrderStatus[]
}

export interface OrderListResponse {
  total: number
  page: number
  limit: number
  orders: OrderListItem[]
}

/* ---------- detail ---------- */
export interface OrderItem {
  id: string
  order_id: string
  product_id: string | null
  variant_id: string | null
  product_name: string
  sku: string | null
  size: string | null
  colour: string | null
  quantity: number
  unit_price_kobo: number
  line_total_kobo: number
  product_snapshot: { image?: string | null; [key: string]: unknown }
  current_stock: number | null
  variant_active: boolean | null
  created_at: string
}

export interface OrderPayment {
  id: string
  provider: string
  provider_reference: string | null
  status: string
  amount_kobo: number
  currency: string
  verified_at: string | null
  created_at: string
}

export interface TimelineEntry {
  id: number
  action: string
  actor_user_id: string | null
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  metadata: Record<string, any>
  created_at: string
}

export interface OrderFull {
  id: string
  order_number: string
  customer_id: string | null
  email: string
  phone: string | null
  status: OrderStatus
  payment_status: string
  currency: string
  subtotal_kobo: number
  shipping_kobo: number
  discount_kobo: number
  total_kobo: number
  shipping_address: Address
  billing_address: Address
  customer_note: string | null
  internal_note: string | null
  tracking_number: string | null
  shipping_provider: string | null
  placed_at: string
  updated_at: string
  customer: { id: string; full_name: string; email: string; phone: string | null; created_at: string } | null
  customer_order_count: number
  items: OrderItem[]
}

export interface OrderDetail {
  order: OrderFull
  payments: OrderPayment[]
  timeline: TimelineEntry[]
  allowed_next_statuses: OrderStatus[]
  flags: { stock_held: boolean; editable_items: boolean; editable_address: boolean }
  reconciliation: {
    items_total_kobo: number
    subtotal_matches_items: boolean
    total_matches_parts: boolean
    paid_kobo: number
    payment_matches_total: boolean
  }
}

export interface InvoiceResponse extends OrderDetail {
  business: Record<string, string> | null
  generated_at: string
}

/* ---------- stats ---------- */
export interface OrderStats {
  from: string
  to: string
  totals: {
    orders: number
    paid_orders: number
    revenue_kobo: number
    avg_order_kobo: number
    refunded_kobo: number
    unique_customers: number
    guest_orders: number
  }
  by_status: Record<string, { count: number; total_kobo: number }>
  by_payment_status: Record<string, number>
  by_provider: Record<string, number>
  series: { date: string; orders: number; revenue_kobo: number }[]
  attention: { unpaid_over_24h: number; to_fulfil_over_48h: number; shipped_over_7d: number }
  truncated: boolean
}

/* ---------- lookups ---------- */
export interface VariantOption {
  id: string
  sku: string | null
  size: string | null
  colour: string | null
  stock_quantity: number
  product_id: string
  product_name: string
  allow_backorder: boolean
  effective_price_kobo: number
}
export interface CustomerOption {
  id: string
  full_name: string
  email: string
  phone: string | null
}

/* ---------- inputs ---------- */
export interface CreateOrderInput {
  customer_id?: string
  full_name?: string
  email?: string
  phone?: string
  items: { variant_id: string; quantity: number; unit_price_kobo?: number }[]
  shipping_address: Address
  billing_address?: Address
  shipping_kobo?: number
  discount_kobo?: number
  customer_note?: string
  internal_note?: string
  reserve_stock?: boolean
  payment?: { type: string; reference: string; note?: string }
}
export interface StatusInput {
  status: OrderStatus
  shipping_provider?: string
  tracking_number?: string
  note?: string
  restock?: boolean
}
export interface BulkStatusResponse {
  ok: boolean
  updated: number
  failed: number
  results: { id: string; ok: boolean; error?: string }[]
}
export interface ExportResponse {
  filename: string
  count: number
  truncated: boolean
  csv: string
}