<script setup lang="ts">
import { ref, reactive, computed, watch, h, onMounted, onBeforeUnmount, nextTick } from 'vue'
import { useRouter, useRoute } from 'vue-router'
import AOS from 'aos'
import 'aos/dist/aos.css'
import ApiService from '@/services/api' // <- adjust to your api service path
import MainLayout from '@/layouts/MainLayout.vue'

/* ------------------------------------------------------------------ */
/* Config                                                              */
/* ------------------------------------------------------------------ */
const ENDPOINT = '/admin-custom' // supabase/functions/admin-custom-requests
const PAGE_SIZE = 20
const REFRESH_MS = 60_000

const ROUTES = {
  order: (id: string) => `/admin/orders/${id}`,
  customRequests: '/custom-requests'
}

// Every call is POST { action, ...payload }. Assumes ApiService.post<T>(url, body) resolves to the response body,
// the same way ApiService.get<T> does on the dashboard.
const call = <T = any,>(action: string, payload: Record<string, unknown> = {}) =>
  ApiService.post<T>(ENDPOINT, { action, ...payload })

const errMsg = (e: any, fallback: string) =>
  e?.response?.data?.error || e?.response?.data?.message || e?.message || fallback

/* ------------------------------------------------------------------ */
/* Types                                                               */
/* ------------------------------------------------------------------ */
type Req = Record<string, any>
interface ListRes {
  items: Req[]
  total: number
  counts: Record<string, number>
  me: { role: string; can_write: boolean }
}
interface DetailRes {
  request: Req
  files: Req[]
  events: Req[]
  order: {
    id: string
    order_number: string
    status: string
    payment_status: string
    total_kobo: number
  } | null
  allowed: string[]
  can_write: boolean
  role: string
}

/* ------------------------------------------------------------------ */
/* State                                                               */
/* ------------------------------------------------------------------ */
const router = useRouter()
const route = useRoute()

const items = ref<Req[]>([])
const total = ref(0)
const counts = ref<Record<string, number>>({})
const me = ref<ListRes['me'] | null>(null)
const page = ref(1)
const status = ref('all')
const q = ref('')
const loading = ref(true)
const loaded = ref(false)
const refreshing = ref(false)
const listError = ref('')
const now = ref(Date.now())

const openId = ref<string | null>(null)
const detail = ref<DetailRes | null>(null)
const detailLoading = ref(false)
const detailError = ref('')
const busy = ref(false)
const noteText = ref('')

const toasts = ref<{ id: number; tone: 'ok' | 'err'; text: string }[]>([])

const reducedMotion =
  typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches

let poll: ReturnType<typeof setInterval> | null = null
let clock: ReturnType<typeof setInterval> | null = null
let searchTimer: ReturnType<typeof setTimeout> | null = null

/* ------------------------------------------------------------------ */
/* Formatting                                                          */
/* ------------------------------------------------------------------ */
const naira = (kobo: number | null | undefined, decimals = 0) =>
  new Intl.NumberFormat('en-NG', {
    style: 'currency',
    currency: 'NGN',
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals
  }).format((Number(kobo) || 0) / 100)

const label = (s: string) => (s || '').replace(/_/g, ' ')

const dateOnly = (d: string | null | undefined) =>
  d
    ? new Date(`${d}T00:00:00`).toLocaleDateString('en-NG', {
        day: 'numeric',
        month: 'short',
        year: 'numeric'
      })
    : '-'

const dateTime = (iso: string) =>
  new Date(iso).toLocaleString('en-NG', {
    day: 'numeric',
    month: 'short',
    hour: 'numeric',
    minute: '2-digit'
  })

function relTime(iso: string) {
  const diff = (Date.parse(iso) - now.value) / 1000
  const rtf = new Intl.RelativeTimeFormat('en', { numeric: 'auto' })
  const abs = Math.abs(diff)
  if (abs < 60) return 'just now'
  if (abs < 3600) return rtf.format(Math.round(diff / 60), 'minute')
  if (abs < 86400) return rtf.format(Math.round(diff / 3600), 'hour')
  return rtf.format(Math.round(diff / 86400), 'day')
}

const initials = (n: string) =>
  (n || '?')
    .split(/\s+/)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase())
    .join('')

const quoteTotal = (r: Req) => (r.quote_kobo ?? 0) + (r.shipping_quote_kobo ?? 0)

const waLink = (p: string) => {
  let d = (p || '').replace(/\D/g, '')
  if (d.startsWith('0')) d = '234' + d.slice(1)
  return `https://wa.me/${d}`
}

const todayIso = () => new Date().toISOString().slice(0, 10)

/** "₦12,500" or "12500.50" -> kobo. NaN when invalid. */
function toKobo(v: string) {
  const n = Number(String(v ?? '').replace(/[₦,\s]/g, ''))
  return Number.isFinite(n) && n >= 0 ? Math.round(n * 100) : NaN
}
const toNaira = (kobo: number | null | undefined) => (kobo == null ? '' : String(kobo / 100))

/* ------------------------------------------------------------------ */
/* Status config                                                       */
/* ------------------------------------------------------------------ */
const TABS = [
  'all',
  'new',
  'in_review',
  'needs_info',
  'quoted',
  'accepted',
  'paid',
  'in_production',
  'ready',
  'completed',
  'declined',
  'cancelled'
]
const TONE: Record<string, string> = {
  new: 'peach',
  in_review: 'blue',
  needs_info: 'amber',
  quoted: 'violet',
  accepted: 'green',
  paid: 'green',
  in_production: 'blue',
  ready: 'violet',
  completed: 'green',
  declined: 'red',
  cancelled: 'grey'
}
const pill = (s: string) => `pill pill-${TONE[s] ?? 'grey'}`
const DONE = new Set(['ready', 'completed', 'declined', 'cancelled'])
// Statuses where the server can email the customer
const NOTIFIES = new Set(['in_production', 'ready', 'completed', 'declined', 'cancelled'])

const ACTION_LABEL: Record<string, string> = {
  in_review: 'Start review',
  needs_info: 'Ask for info',
  quoted: 'Send quote',
  accepted: 'Mark accepted',
  paid: 'Record payment',
  in_production: 'Start production',
  ready: 'Mark ready',
  completed: 'Complete',
  declined: 'Decline',
  cancelled: 'Cancel request'
}
const actionLabel = (from: string, to: string) => {
  if (to === 'quoted' && from === 'quoted') return 'Revise quote'
  if (to === 'in_review' && (from === 'declined' || from === 'cancelled')) return 'Reopen'
  if (to === 'in_review') return 'Back to review'
  if (to === 'in_production' && from === 'ready') return 'Back to production'
  if (to === 'quoted') return 'Send quote'
  return ACTION_LABEL[to] ?? label(to)
}
const isDanger = (to: string) => to === 'declined' || to === 'cancelled'

const dueInfo = (r: Req) => {
  if (!r.needed_by || DONE.has(r.status) || r.status === 'paid' || r.status === 'in_production')
    return null
  const start = new Date()
  start.setHours(0, 0, 0, 0)
  const days = Math.round((Date.parse(`${r.needed_by}T00:00:00`) - start.getTime()) / 86400000)
  if (days < 0) return { text: `${Math.abs(days)}d overdue`, tone: 'red' }
  if (days === 0) return { text: 'Due today', tone: 'red' }
  if (days <= 7) return { text: `Due in ${days}d`, tone: 'amber' }
  return null
}

/* ------------------------------------------------------------------ */
/* Icons (inline, no icon-font dependency)                             */
/* ------------------------------------------------------------------ */
const icons: Record<string, string> = {
  refresh:
    'M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8 M21 3v5h-5 M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16 M8 16H3v5',
  ruler:
    'M21.3 15.3a2.4 2.4 0 0 1 0 3.4l-2.6 2.6a2.4 2.4 0 0 1-3.4 0L2.7 8.7a2.4 2.4 0 0 1 0-3.4l2.6-2.6a2.4 2.4 0 0 1 3.4 0Z M14.5 12.5l2-2 M11.5 9.5l2-2 M8.5 6.5l2-2 M17.5 15.5l2-2',
  mail: 'M22 7l-8.97 5.7a1.94 1.94 0 0 1-2.06 0L2 7 M4 4h16a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2Z',
  wallet:
    'M19 7V4a1 1 0 0 0-1-1H5a2 2 0 0 0 0 4h15a1 1 0 0 1 1 1v4h-3a2 2 0 0 0 0 4h3a1 1 0 0 0 1-1v-2a1 1 0 0 0-1-1 M3 5v14a2 2 0 0 0 2 2h15a1 1 0 0 0 1-1v-4',
  package:
    'm7.5 4.27 9 5.15 M21 8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16Z M3.3 7 12 12l8.7-5 M12 22V12',
  alert:
    'm21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3 M12 9v4 M12 17h.01',
  search: 'm21 21-4.3-4.3 M11 19a8 8 0 1 0 0-16 8 8 0 0 0 0 16Z',
  x: 'M18 6 6 18 M6 6l12 12',
  left: 'm15 18-6-6 6-6',
  right: 'm9 18 6-6-6-6',
  ext: 'M15 3h6v6 M10 14 21 3 M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6',
  file: 'M14.5 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7.5Z M14 2v6h6',
  trash: 'M3 6h18 M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6 M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2',
  edit: 'M12 20h9 M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z',
  send: 'm22 2-7 20-4-9-9-4Z M22 2 11 13',
  phone:
    'M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72c.127.96.361 1.903.7 2.81a2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45c.907.339 1.85.573 2.81.7A2 2 0 0 1 22 16.92Z',
  check: 'M20 6 9 17l-5-5'
}
// Small functional component: <Ico n="mail" class="h-4 w-4" />
const Ico = (p: any) =>
  h(
    'svg',
    {
      class: p.class,
      viewBox: '0 0 24 24',
      fill: 'none',
      stroke: 'currentColor',
      'stroke-width': 2,
      'stroke-linecap': 'round',
      'stroke-linejoin': 'round',
      'aria-hidden': 'true'
    },
    [h('path', { d: icons[p.n] })]
  )

/* ------------------------------------------------------------------ */
/* Toasts                                                              */
/* ------------------------------------------------------------------ */
let toastId = 0
function toast(text: string, tone: 'ok' | 'err' = 'ok') {
  const id = ++toastId
  toasts.value.push({ id, tone, text })
  setTimeout(() => (toasts.value = toasts.value.filter((t) => t.id !== id)), 4200)
}

/* ------------------------------------------------------------------ */
/* KPI cards (click to filter)                                         */
/* ------------------------------------------------------------------ */
const kpis = computed(() =>
  [
    { key: 'new', label: 'New', sub: 'Waiting for a first look', icon: 'ruler', tone: 'primary' },
    {
      key: 'needs_info',
      label: 'Needs info',
      sub: 'Waiting on the customer',
      icon: 'mail',
      tone: 'amber'
    },
    { key: 'quoted', label: 'Quoted', sub: 'Waiting on payment', icon: 'wallet', tone: 'peach' },
    {
      key: 'in_production',
      label: 'In production',
      sub: 'Being made',
      icon: 'package',
      tone: 'green'
    }
  ].map((k) => ({ ...k, value: counts.value[k.key] ?? 0 }))
)

const tabCount = (k: string) =>
  k === 'all' ? Object.values(counts.value).reduce((a, b) => a + b, 0) : (counts.value[k] ?? 0)

/* ------------------------------------------------------------------ */
/* List                                                                */
/* ------------------------------------------------------------------ */
let listSeq = 0
async function loadList(opts: { manual?: boolean; silent?: boolean } = {}) {
  const seq = ++listSeq
  if (opts.manual) refreshing.value = true
  else if (!opts.silent) loading.value = true
  try {
    const d = await call<ListRes>('list', {
      page: page.value,
      pageSize: PAGE_SIZE,
      status: status.value,
      q: q.value
    })
    if (seq !== listSeq) return
    items.value = d.items ?? []
    total.value = d.total ?? 0
    counts.value = d.counts ?? {}
    me.value = d.me ?? null
    listError.value = ''
    loaded.value = true
    nextTick(() => AOS.refreshHard())
  } catch (e: any) {
    if (seq !== listSeq) return
    // Keep stale rows on background failures
    if (!opts.silent || !items.value.length)
      listError.value = errMsg(e, 'Could not load custom requests')
  } finally {
    if (seq === listSeq) {
      loading.value = false
      refreshing.value = false
    }
  }
}

const pages = computed(() => Math.max(1, Math.ceil(total.value / PAGE_SIZE)))
const rangeLabel = computed(() => {
  if (!total.value) return 'No results'
  const a = (page.value - 1) * PAGE_SIZE + 1
  return `${a}-${Math.min(total.value, a + items.value.length - 1)} of ${total.value}`
})

function setStatus(s: string) {
  if (status.value === s) return
  status.value = s
  page.value = 1
  loadList()
}
function goPage(p: number) {
  if (p < 1 || p > pages.value || p === page.value) return
  page.value = p
  loadList()
}
watch(q, () => {
  if (searchTimer) clearTimeout(searchTimer)
  searchTimer = setTimeout(() => {
    page.value = 1
    loadList()
  }, 350)
})

/* ------------------------------------------------------------------ */
/* Detail drawer                                                       */
/* ------------------------------------------------------------------ */
let detailSeq = 0
async function loadDetail(id: string, silent = false) {
  const seq = ++detailSeq
  if (!silent) {
    detail.value = null
    detailError.value = ''
    detailLoading.value = true
  }
  try {
    const d = await call<DetailRes>('get', { id })
    if (seq !== detailSeq) return
    detail.value = d
    detailError.value = ''
  } catch (e: any) {
    if (seq !== detailSeq) return
    if (!silent || !detail.value) detailError.value = errMsg(e, 'Could not load this request')
  } finally {
    if (seq === detailSeq) detailLoading.value = false
  }
}

function openRequest(id: string) {
  openId.value = id
  noteText.value = ''
  router.replace({ query: { ...route.query, id } })
  loadDetail(id)
}
function closeDrawer() {
  detailSeq++
  openId.value = null
  detail.value = null
  const { id, ...rest } = route.query
  router.replace({ query: rest })
}

const req = computed(() => detail.value?.request ?? null)
const canWrite = computed(() => detail.value?.can_write ?? me.value?.can_write ?? false)
const actions = computed(() =>
  req.value
    ? (detail.value?.allowed ?? []).map((to) => ({ to, text: actionLabel(req.value!.status, to) }))
    : []
)
const canRevert = computed(
  () =>
    canWrite.value &&
    ['owner', 'admin'].includes(detail.value?.role ?? '') &&
    !!req.value?.order_id &&
    ['paid', 'in_production'].includes(req.value?.status ?? '')
)
const EXCLUDE = new Set([
  'request_number',
  'name',
  'email',
  'phone',
  'outfit_type',
  'status',
  'needed_by',
  'event_date',
  'quantity',
  'quote_kobo',
  'shipping_quote_kobo',
  'quote_expires_at',
  'quote_note',
  'payment_link',
  'agreed_timeline',
  'internal_notes',
  'order_id'
])
// Anything else on the row (description, budget, measurements, fabric...) shows up under "Brief"
const extras = computed(() =>
  Object.entries(req.value ?? {})
    .filter(
      ([k, v]) =>
        !EXCLUDE.has(k) &&
        !/(^id$|_id$|_at$|token)/.test(k) &&
        v !== null &&
        v !== '' &&
        !(Array.isArray(v) && !v.length)
    )
    .map(([k, v]) => ({
      k: label(k.replace(/_kobo$/, '')),
      v: k.endsWith('_kobo')
        ? naira(v as number)
        : Array.isArray(v)
          ? v.join(', ')
          : typeof v === 'object'
            ? JSON.stringify(v, null, 2)
            : String(v)
    }))
)

const isImage = (f: Req) =>
  /\.(png|jpe?g|webp|gif|avif)$/i.test(f.storage_path || '') ||
  String(f.mime_type || '').startsWith('image/')
const fileName = (f: Req) =>
  f.file_name ||
  f.original_name ||
  String(f.storage_path || '')
    .split('/')
    .pop() ||
  'File'

const EVENT_TONE: Record<string, string> = {
  status: 'blue',
  quote: 'violet',
  note: 'amber',
  email: 'grey',
  updated: 'grey',
  payment: 'green'
}
function eventTitle(e: Req) {
  const m = e.metadata || {}
  switch (e.event_type) {
    case 'status':
      return e.from_status
        ? `Moved from ${label(e.from_status)} to ${label(e.to_status)}`
        : `Set to ${label(e.to_status)}`
    case 'quote':
      return `Quote sent for ${naira((m.quote_kobo ?? 0) + (m.shipping_kobo ?? 0))}`
    case 'note':
      return 'Internal note'
    case 'updated':
      return Array.isArray(m) && m.length ? `Updated ${m.map(label).join(', ')}` : 'Details updated'
    case 'email':
      return 'Email to customer'
    case 'payment_reverted':
      return `Payment reverted${m.order_number ? ` (order ${m.order_number})` : ''}`
    default:
      return label(e.event_type || 'event')
  }
}

/* ------------------------------------------------------------------ */
/* Mutations                                                           */
/* ------------------------------------------------------------------ */
async function refreshAfter() {
  if (!openId.value) return
  await Promise.all([loadDetail(openId.value, true), loadList({ silent: true })])
}

async function quick(action: string, payload: Record<string, unknown>, ok: string) {
  busy.value = true
  try {
    await call(action, { id: openId.value, ...payload })
    toast(ok)
    await refreshAfter()
    return true
  } catch (e: any) {
    toast(errMsg(e, 'Something went wrong'), 'err')
    refreshAfter()
    return false
  } finally {
    busy.value = false
  }
}

function runAction(to: string) {
  if (to === 'needs_info') return openModal('info')
  if (to === 'quoted') return openModal('quote')
  if (to === 'paid') return openModal('payment')
  if (NOTIFIES.has(to)) return openModal('status', to)
  quick('set_status', { status: to, notify: false }, `Moved to ${label(to)}`)
}

async function addNote() {
  const note = noteText.value.trim()
  if (!note) return
  if (await quick('add_note', { note }, 'Note added')) noteText.value = ''
}
const resend = (kind: 'received' | 'quoted') =>
  quick('resend', { kind }, kind === 'quoted' ? 'Quote email resent' : 'Confirmation email resent')

/* ------------------------------------------------------------------ */
/* Modal (one component, several forms)                                */
/* ------------------------------------------------------------------ */
const modal = reactive({
  type: '' as '' | 'status' | 'info' | 'quote' | 'payment' | 'edit' | 'delete' | 'revert',
  to: '',
  error: '',
  busy: false
})
const f = reactive({
  message: '',
  notify: true,
  price: '',
  shipping: '',
  expires: '',
  timeline: '',
  link: '',
  amount: '',
  provider: 'manual',
  reference: '',
  quantity: '',
  neededBy: '',
  eventDate: '',
  notes: ''
})

function openModal(type: typeof modal.type, to = '') {
  const r = req.value
  if (!r) return
  Object.assign(f, {
    message: '',
    notify: true,
    price: '',
    shipping: '',
    expires: '',
    timeline: '',
    link: '',
    amount: '',
    provider: 'manual',
    reference: '',
    quantity: '',
    neededBy: '',
    eventDate: '',
    notes: ''
  })
  if (type === 'quote') {
    f.price = toNaira(r.quote_kobo)
    f.shipping = toNaira(r.shipping_quote_kobo)
    f.expires = r.quote_expires_at ? String(r.quote_expires_at).slice(0, 10) : ''
    f.timeline = r.agreed_timeline ?? ''
    f.link = r.payment_link ?? ''
    f.message = r.quote_note ?? ''
  }
  if (type === 'payment') f.amount = toNaira(quoteTotal(r))
  if (type === 'edit') {
    f.quantity = String(r.quantity ?? 1)
    f.neededBy = r.needed_by ? String(r.needed_by).slice(0, 10) : ''
    f.eventDate = r.event_date ? String(r.event_date).slice(0, 10) : ''
    f.timeline = r.agreed_timeline ?? ''
    f.notes = r.internal_notes ?? ''
  }
  modal.type = type
  modal.to = to
  modal.error = ''
  modal.busy = false
}
const closeModal = () => {
  if (!modal.busy) modal.type = ''
}

const modalTitle = computed(() => {
  switch (modal.type) {
    case 'status':
      return actionLabel(req.value?.status ?? '', modal.to)
    case 'info':
      return 'Ask the customer for more info'
    case 'quote':
      return req.value?.status === 'quoted' ? 'Revise quote' : 'Send quote'
    case 'payment':
      return 'Record payment'
    case 'revert':
      return 'Revert payment'
    case 'edit':
      return 'Edit details'
    case 'delete':
      return 'Delete this request?'
    default:
      return ''
  }
})
const quotePreview = computed(() => {
  const a = toKobo(f.price)
  const b = f.shipping ? toKobo(f.shipping) : 0
  return Number.isNaN(a) || Number.isNaN(b) ? null : a + b
})

async function submitModal() {
  modal.error = ''
  const r = req.value
  if (!r) return
  let action = ''
  let payload: Record<string, unknown> = {}
  let ok = ''

  if (modal.type === 'status') {
    const msg = f.message.trim()
    if (modal.to === 'declined' && !msg)
      return (modal.error = 'Add a short reason for the customer')
    action = 'set_status'
    payload = { status: modal.to, message: msg || undefined, notify: f.notify }
    ok = `Moved to ${label(modal.to)}`
  } else if (modal.type === 'info') {
    if (!f.message.trim()) return (modal.error = 'Write what you need from the customer')
    action = 'request_info'
    payload = { message: f.message.trim() }
    ok = 'Info request sent'
  } else if (modal.type === 'quote') {
    const price = toKobo(f.price)
    const ship = f.shipping ? toKobo(f.shipping) : 0
    if (Number.isNaN(price) || price <= 0)
      return (modal.error = 'Outfit price must be more than zero')
    if (Number.isNaN(ship)) return (modal.error = 'Delivery must be a valid amount')
    if (f.link.trim() && !/^https:\/\//i.test(f.link.trim()))
      return (modal.error = 'Payment link must start with https://')
    if (f.expires && f.expires < todayIso()) return (modal.error = 'Expiry date is in the past')
    action = 'send_quote'
    payload = {
      quote_kobo: price,
      shipping_kobo: ship,
      payment_link: f.link.trim() || undefined,
      quote_expires_at: f.expires || undefined,
      agreed_timeline: f.timeline.trim() || undefined,
      message: f.message.trim() || undefined,
      notify: f.notify
    }
    ok = 'Quote sent'
  } else if (modal.type === 'payment') {
    const amt = toKobo(f.amount)
    if (Number.isNaN(amt) || amt <= 0) return (modal.error = 'Enter the amount received')
    action = 'record_payment'
    payload = {
      amount_kobo: amt,
      provider: f.provider,
      reference: f.reference.trim() || undefined,
      notify: f.notify
    }
    ok = 'Payment recorded'
  } else if (modal.type === 'edit') {
    action = 'update'
    payload = {
      internal_notes: f.notes,
      agreed_timeline: f.timeline,
      needed_by: f.neededBy || null,
      event_date: f.eventDate || null
    }
    const qty = Number(f.quantity)
    if (!Number.isInteger(qty) || qty < 1 || qty > 50)
      return (modal.error = 'Quantity must be between 1 and 50')
    // The server rejects quantity edits once an order exists, so only send it when it changed
    if (qty !== r.quantity) payload.quantity = qty
    ok = 'Details saved'
  } else if (modal.type === 'revert') {
    if (!f.message.trim()) return (modal.error = 'Add a reason for reverting the payment')
    action = 'revert_payment'
    payload = { reason: f.message.trim() }
    ok = 'Payment reverted'
  } else if (modal.type === 'delete') {
    action = 'delete'
    ok = 'Request deleted'
  } else return

  modal.busy = true
  try {
    const res: any = await call(action, { id: r.id, ...payload })
    modal.type = ''
    if (action === 'record_payment' && res?.order?.order_number)
      toast(`Payment recorded. Order ${res.order.order_number} created`)
    else toast(ok)
    if (action === 'delete') {
      closeDrawer()
      loadList({ silent: true })
    } else await refreshAfter()
  } catch (e: any) {
    modal.error = errMsg(e, 'Something went wrong')
    refreshAfter() // the row may have changed under us (409)
  } finally {
    modal.busy = false
  }
}

/* ------------------------------------------------------------------ */
/* Lifecycle                                                           */
/* ------------------------------------------------------------------ */
function onKey(e: KeyboardEvent) {
  if (e.key !== 'Escape') return
  if (modal.type) closeModal()
  else if (openId.value) closeDrawer()
}
watch(
  () => !!openId.value || !!modal.type,
  (locked) => (document.body.style.overflow = locked ? 'hidden' : '')
)

onMounted(() => {
  AOS.init({
    duration: 700,
    easing: 'ease-out-cubic',
    once: true,
    offset: 30,
    disable: () => reducedMotion
  })
  loadList()
  const id = route.query.id
  if (typeof id === 'string' && id) openRequest(id)
  poll = setInterval(() => {
    loadList({ silent: true })
    if (openId.value && !busy.value && !modal.type) loadDetail(openId.value, true)
  }, REFRESH_MS)
  clock = setInterval(() => (now.value = Date.now()), 30_000)
  window.addEventListener('keydown', onKey)
})

onBeforeUnmount(() => {
  if (poll) clearInterval(poll)
  if (clock) clearInterval(clock)
  if (searchTimer) clearTimeout(searchTimer)
  window.removeEventListener('keydown', onKey)
  document.body.style.overflow = ''
})
</script>

<template>
  <MainLayout>
    <div class="dash p-4">
      <!-- Header -->
      <header class="mb-7 flex flex-wrap items-end justify-between gap-4" data-aos="fade-down">
        <div>
          <h1 class="title">Custom requests</h1>
          <p class="muted mt-1">Review briefs, send quotes and turn paid requests into orders</p>
        </div>
        <button class="btn-ghost" :disabled="refreshing" @click="loadList({ manual: true })">
          <Ico n="refresh" class="h-4 w-4" :class="{ 'animate-spin': refreshing }" />
          <span>{{ refreshing ? 'Refreshing' : 'Refresh' }}</span>
        </button>
      </header>

      <div v-if="me && !me.can_write" class="notice mb-5" data-aos="fade-in">
        You can view requests but your role can't change them.
      </div>

      <!-- KPIs -->
      <section class="mb-6 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <template v-if="!loaded">
          <div v-for="n in 4" :key="n" class="card skeleton h-[148px]"></div>
        </template>
        <button
          v-for="(k, i) in kpis"
          v-else
          :key="k.key"
          class="card kpi text-left"
          :class="{ 'kpi-on': status === k.key }"
          data-aos="fade-up"
          :data-aos-delay="i * 80"
          @click="setStatus(status === k.key ? 'all' : k.key)"
        >
          <div class="kpi-icon" :class="`tone-${k.tone}`"><Ico :n="k.icon" class="h-5 w-5" /></div>
          <p class="kpi-label">{{ k.label }}</p>
          <p class="kpi-value">{{ k.value }}</p>
          <p class="kpi-sub">{{ k.sub }}</p>
        </button>
      </section>

      <!-- List -->
      <section class="card overflow-hidden" data-aos="fade-up" data-aos-delay="100">
        <div class="space-y-4 px-6 pt-6 pb-4">
          <div class="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 class="card-title">All requests</h2>
              <p class="muted">{{ loaded ? rangeLabel : 'Loading' }}</p>
            </div>
            <label class="search">
              <Ico n="search" class="h-4 w-4" />
              <input
                v-model="q"
                type="search"
                placeholder="Search name, email, number or outfit"
                aria-label="Search requests"
              />
            </label>
          </div>
          <div class="chips" role="tablist" aria-label="Filter by status">
            <button
              v-for="t in TABS"
              :key="t"
              class="chip"
              :class="{ on: status === t }"
              role="tab"
              :aria-selected="status === t"
              @click="setStatus(t)"
            >
              <span class="capitalize">{{ label(t) }}</span>
              <span v-if="loaded" class="chip-count">{{ tabCount(t) }}</span>
            </button>
          </div>
        </div>

        <!-- Error -->
        <div v-if="listError && !items.length" class="p-10 text-center">
          <div class="kpi-icon tone-red mx-auto mb-4"><Ico n="alert" class="h-5 w-5" /></div>
          <h3 class="text-base font-semibold text-[var(--ink)]">Couldn't load requests</h3>
          <p class="muted mt-1">{{ listError }}</p>
          <button class="btn-primary mt-5" @click="loadList({ manual: true })">Try again</button>
        </div>

        <!-- Skeleton -->
        <div v-else-if="loading" class="px-6 pb-6">
          <div v-for="n in 7" :key="n" class="sk-row">
            <div class="skeleton sk-circle"></div>
            <div class="flex-1 space-y-2">
              <div class="skeleton sk-line" style="width: 40%"></div>
              <div class="skeleton sk-line" style="width: 25%; height: 9px"></div>
            </div>
            <div class="skeleton sk-line hidden sm:block" style="width: 90px"></div>
            <div class="skeleton sk-line" style="width: 76px; height: 22px"></div>
          </div>
        </div>

        <!-- Empty -->
        <div v-else-if="!items.length" class="px-6 py-14 text-center">
          <div class="kpi-icon tone-peach mx-auto mb-4"><Ico n="ruler" class="h-5 w-5" /></div>
          <h3 class="text-base font-semibold text-[var(--ink)]">No requests found</h3>
          <p class="muted mt-1">
            {{
              q || status !== 'all'
                ? 'Try a different search or clear the filter.'
                : 'New custom requests will show up here.'
            }}
          </p>
          <button
            v-if="q || status !== 'all'"
            class="btn-ghost mt-5"
            @click="((q = ''), setStatus('all'))"
          >
            Clear filters
          </button>
        </div>

        <!-- Table -->
        <div v-else class="overflow-x-auto">
          <table class="w-full min-w-[820px] text-left">
            <thead>
              <tr>
                <th class="th pl-6">Request</th>
                <th class="th">Customer</th>
                <th class="th">Outfit</th>
                <th class="th">Needed by</th>
                <th class="th">Quote</th>
                <th class="th">Status</th>
                <th class="th pr-6 text-right">Updated</th>
              </tr>
            </thead>
            <tbody>
              <tr
                v-for="(r, i) in items"
                :key="r.id"
                class="row"
                tabindex="0"
                data-aos="fade-up"
                :data-aos-delay="Math.min(i, 8) * 40"
                @click="openRequest(r.id)"
                @keydown.enter="openRequest(r.id)"
              >
                <td class="td pl-6">
                  <p class="font-medium text-[var(--ink)]">{{ r.request_number }}</p>
                  <p class="cell-sub">{{ relTime(r.created_at) }}</p>
                </td>
                <td class="td">
                  <div class="flex items-center gap-2.5">
                    <span class="avatar">{{ initials(r.name) }}</span>
                    <div class="min-w-0">
                      <p class="truncate text-[var(--ink)]">{{ r.name }}</p>
                      <p class="cell-sub truncate">{{ r.email }}</p>
                    </div>
                  </div>
                </td>
                <td class="td capitalize text-[var(--ink)]">{{ r.outfit_type || '-' }}</td>
                <td class="td">
                  <p class="text-[var(--ink)]">{{ dateOnly(r.needed_by) }}</p>
                  <p
                    v-if="dueInfo(r)"
                    class="cell-sub font-semibold"
                    :class="`due-${dueInfo(r)!.tone}`"
                  >
                    {{ dueInfo(r)!.text }}
                  </p>
                </td>
                <td class="td font-medium tabular-nums text-[var(--ink)]">
                  {{ r.quote_kobo != null ? naira(quoteTotal(r)) : '-' }}
                </td>
                <td class="td">
                  <span :class="pill(r.status)">{{ label(r.status) }}</span>
                  <span
                    v-if="r.status === 'needs_info' && r.last_customer_reply_at"
                    class="reply"
                    title="Customer replied"
                  >
                    <span class="dot"></span>Replied
                  </span>
                </td>
                <td class="td pr-6 text-right cell-sub">{{ relTime(r.updated_at) }}</td>
              </tr>
            </tbody>
          </table>
        </div>

        <!-- Pagination -->
        <div
          v-if="loaded && total > PAGE_SIZE"
          class="flex items-center justify-between border-t border-[var(--line)] px-6 py-3"
        >
          <p class="muted">Page {{ page }} of {{ pages }}</p>
          <div class="flex gap-2">
            <button
              class="btn-ghost"
              :disabled="page <= 1 || loading"
              aria-label="Previous page"
              @click="goPage(page - 1)"
            >
              <Ico n="left" class="h-4 w-4" />
            </button>
            <button
              class="btn-ghost"
              :disabled="page >= pages || loading"
              aria-label="Next page"
              @click="goPage(page + 1)"
            >
              <Ico n="right" class="h-4 w-4" />
            </button>
          </div>
        </div>
      </section>

      <!-- ============ Detail drawer ============ -->
      <Transition name="fade">
        <div v-if="openId" class="crq-overlay" @click="closeDrawer"></div>
      </Transition>
      <Transition name="drawer">
        <aside
          v-if="openId"
          class="drawer"
          role="dialog"
          aria-modal="true"
          aria-label="Request details"
        >
          <header class="drawer-head">
            <div class="min-w-0">
              <template v-if="req">
                <div class="flex flex-wrap items-center gap-2">
                  <h2 class="card-title">{{ req.request_number }}</h2>
                  <span :class="pill(req.status)">{{ label(req.status) }}</span>
                </div>
                <p class="muted mt-0.5 truncate">{{ req.name }} · {{ req.outfit_type }}</p>
              </template>
              <div v-else class="space-y-2">
                <div class="skeleton sk-line" style="width: 150px; height: 16px"></div>
                <div class="skeleton sk-line" style="width: 200px; height: 11px"></div>
              </div>
            </div>
            <button class="icon-btn" aria-label="Close" @click="closeDrawer">
              <Ico n="x" class="h-4 w-4" />
            </button>
          </header>

          <div class="drawer-body">
            <!-- Skeleton -->
            <div v-if="detailLoading && !detail" class="space-y-4">
              <div class="skeleton sk-block" style="height: 44px"></div>
              <div class="skeleton sk-block" style="height: 120px"></div>
              <div class="skeleton sk-block" style="height: 170px"></div>
              <div class="skeleton sk-block" style="height: 140px"></div>
            </div>

            <!-- Error -->
            <div v-else-if="detailError && !detail" class="p-8 text-center">
              <div class="kpi-icon tone-red mx-auto mb-4"><Ico n="alert" class="h-5 w-5" /></div>
              <h3 class="text-base font-semibold text-[var(--ink)]">Couldn't load this request</h3>
              <p class="muted mt-1">{{ detailError }}</p>
              <button class="btn-primary mt-5" @click="loadDetail(openId!)">Try again</button>
            </div>

            <template v-else-if="detail && req">
              <!-- Actions -->
              <div v-if="canWrite" class="panel">
                <p class="panel-title">Next step</p>
                <div v-if="actions.length" class="flex flex-wrap gap-2">
                  <button
                    v-for="a in actions"
                    :key="a.to"
                    :class="
                      isDanger(a.to)
                        ? 'btn-danger'
                        : a.to === actions[0].to
                          ? 'btn-primary'
                          : 'btn-ghost'
                    "
                    :disabled="busy"
                    @click="runAction(a.to)"
                  >
                    {{ a.text }}
                  </button>
                </div>
                <p v-else class="muted">This request is finished. No further steps.</p>
                <div class="mt-3 flex flex-wrap gap-2">
                  <button class="btn-ghost" :disabled="busy" @click="openModal('edit')">
                    <Ico n="edit" class="h-4 w-4" />Edit details
                  </button>
                  <button class="btn-ghost" :disabled="busy" @click="resend('received')">
                    <Ico n="send" class="h-4 w-4" />Resend confirmation
                  </button>
                  <button
                    v-if="req.quote_kobo != null"
                    class="btn-ghost"
                    :disabled="busy"
                    @click="resend('quoted')"
                  >
                    <Ico n="send" class="h-4 w-4" />Resend quote
                  </button>
                  <button
                    v-if="detail.role === 'owner' && !req.order_id"
                    class="btn-danger"
                    :disabled="busy"
                    @click="openModal('delete')"
                  >
                    <Ico n="trash" class="h-4 w-4" />Delete
                  </button>
                  <button
                    v-if="canRevert"
                    class="btn-danger"
                    :disabled="busy"
                    @click="openModal('revert')"
                  >
                    <Ico n="refresh" class="h-4 w-4" />Revert payment
                  </button>
                </div>
              </div>

              <!-- Customer -->
              <div class="panel">
                <p class="panel-title">Customer</p>
                <div class="flex items-center gap-3">
                  <span class="avatar lg">{{ initials(req.name) }}</span>
                  <div class="min-w-0">
                    <p class="truncate font-medium text-[var(--ink)]">{{ req.name }}</p>
                    <a class="cell-link" :href="`mailto:${req.email}`">{{ req.email }}</a>
                  </div>
                </div>
                <div v-if="req.phone" class="mt-3 flex flex-wrap gap-2">
                  <a class="btn-ghost" :href="`tel:${req.phone}`"
                    ><Ico n="phone" class="h-4 w-4" />{{ req.phone }}</a
                  >
                  <a class="btn-ghost" :href="waLink(req.phone)" target="_blank" rel="noopener"
                    ><Ico n="ext" class="h-4 w-4" />WhatsApp</a
                  >
                </div>
              </div>

              <!-- Brief -->
              <div class="panel">
                <p class="panel-title">Brief</p>
                <dl class="kv">
                  <dt>Outfit</dt>
                  <dd class="capitalize">{{ req.outfit_type || '-' }}</dd>
                  <dt>Quantity</dt>
                  <dd>{{ req.quantity ?? 1 }}</dd>
                  <dt>Needed by</dt>
                  <dd>
                    {{ dateOnly(req.needed_by) }}
                    <span
                      v-if="dueInfo(req)"
                      class="ml-1 font-semibold"
                      :class="`due-${dueInfo(req)!.tone}`"
                      >{{ dueInfo(req)!.text }}</span
                    >
                  </dd>
                  <dt>Event date</dt>
                  <dd>{{ dateOnly(req.event_date) }}</dd>
                  <dt>Timeline</dt>
                  <dd>{{ req.agreed_timeline || '-' }}</dd>
                  <template v-for="x in extras" :key="x.k">
                    <dt class="capitalize">{{ x.k }}</dt>
                    <dd class="whitespace-pre-wrap break-words">{{ x.v }}</dd>
                  </template>
                </dl>
              </div>

              <!-- Quote -->
              <div v-if="req.quote_kobo != null" class="panel">
                <p class="panel-title">Quote</p>
                <dl class="kv">
                  <dt>Outfit</dt>
                  <dd class="tabular-nums">{{ naira(req.quote_kobo, 2) }}</dd>
                  <dt>Delivery</dt>
                  <dd class="tabular-nums">{{ naira(req.shipping_quote_kobo, 2) }}</dd>
                  <dt>Total</dt>
                  <dd class="font-bold tabular-nums">{{ naira(quoteTotal(req), 2) }}</dd>
                  <dt>Expires</dt>
                  <dd>{{ dateOnly(req.quote_expires_at) }}</dd>
                  <dt v-if="req.payment_link">Payment link</dt>
                  <dd v-if="req.payment_link">
                    <a
                      class="cell-link break-all"
                      :href="req.payment_link"
                      target="_blank"
                      rel="noopener"
                      >{{ req.payment_link }}</a
                    >
                  </dd>
                  <dt v-if="req.quote_note">Message</dt>
                  <dd v-if="req.quote_note" class="whitespace-pre-wrap">{{ req.quote_note }}</dd>
                </dl>
              </div>

              <!-- Linked order -->
              <div v-if="detail.order" class="panel">
                <p class="panel-title">Order</p>
                <button class="order-link" @click="router.push(ROUTES.order(detail.order.id))">
                  <div class="text-left">
                    <p class="font-medium text-[var(--ink)]">{{ detail.order.order_number }}</p>
                    <p class="cell-sub">{{ naira(detail.order.total_kobo, 2) }}</p>
                  </div>
                  <div class="flex items-center gap-2">
                    <span class="pill pill-green">{{ label(detail.order.payment_status) }}</span>
                    <span class="pill pill-blue">{{ label(detail.order.status) }}</span>
                    <Ico n="ext" class="h-4 w-4 text-[var(--muted)]" />
                  </div>
                </button>
              </div>

              <!-- Files -->
              <div class="panel">
                <p class="panel-title">
                  Reference files <span class="muted">({{ detail.files.length }})</span>
                </p>
                <p v-if="!detail.files.length" class="muted">
                  The customer didn't attach anything.
                </p>
                <div v-else class="files">
                  <a
                    v-for="file in detail.files"
                    :key="file.id"
                    class="file"
                    :href="file.url || undefined"
                    target="_blank"
                    rel="noopener"
                    :title="fileName(file)"
                  >
                    <img
                      v-if="file.url && isImage(file)"
                      :src="file.url"
                      :alt="fileName(file)"
                      loading="lazy"
                    />
                    <span v-else class="file-ph"><Ico n="file" class="h-6 w-6" /></span>
                    <span class="file-name">{{ fileName(file) }}</span>
                  </a>
                </div>
              </div>

              <!-- Internal notes -->
              <div v-if="req.internal_notes" class="panel">
                <p class="panel-title">Internal notes</p>
                <p class="whitespace-pre-wrap text-[13.5px] text-[var(--ink)]">
                  {{ req.internal_notes }}
                </p>
              </div>

              <!-- Activity -->
              <div class="panel">
                <p class="panel-title">Activity</p>
                <div v-if="canWrite" class="mb-5 flex gap-2">
                  <textarea
                    v-model="noteText"
                    class="input"
                    rows="2"
                    maxlength="2000"
                    placeholder="Add an internal note (the customer won't see it)"
                    @keydown.meta.enter="addNote"
                    @keydown.ctrl.enter="addNote"
                  ></textarea>
                  <button
                    class="btn-ghost self-end"
                    :disabled="busy || !noteText.trim()"
                    @click="addNote"
                  >
                    Add note
                  </button>
                </div>
                <p v-if="!detail.events.length" class="muted">No activity yet.</p>
                <ol v-else class="tl">
                  <li v-for="e in detail.events" :key="e.id">
                    <span
                      class="tl-dot"
                      :class="`dot-${EVENT_TONE[e.event_type] ?? 'grey'}`"
                    ></span>
                    <p class="text-[13.5px] font-medium text-[var(--ink)]">{{ eventTitle(e) }}</p>
                    <p v-if="e.note" class="tl-note">{{ e.note }}</p>
                    <p class="cell-sub">
                      {{ dateTime(e.created_at) }} · {{ relTime(e.created_at) }}
                    </p>
                  </li>
                </ol>
              </div>
            </template>
          </div>
        </aside>
      </Transition>

      <!-- ============ Modal ============ -->
      <Transition name="pop">
        <div v-if="modal.type" class="crq-dlg-wrap" @mousedown.self="closeModal">
          <form
            class="crq-dlg card"
            role="dialog"
            aria-modal="true"
            :aria-label="modalTitle"
            @submit.prevent="submitModal"
          >
            <header class="mb-4 flex items-start justify-between gap-3">
              <h3 class="card-title">{{ modalTitle }}</h3>
              <button type="button" class="icon-btn" aria-label="Close" @click="closeModal">
                <Ico n="x" class="h-4 w-4" />
              </button>
            </header>

            <!-- status -->
            <template v-if="modal.type === 'status'">
              <label class="field-label" for="m-msg">
                {{
                  modal.to === 'declined'
                    ? 'Reason for the customer'
                    : 'Message to the customer (optional)'
                }}
              </label>
              <textarea
                id="m-msg"
                v-model="f.message"
                class="input"
                rows="4"
                maxlength="2000"
              ></textarea>
              <label class="check"
                ><input v-model="f.notify" type="checkbox" /> Email the customer about this</label
              >
            </template>

            <!-- info -->
            <template v-else-if="modal.type === 'info'">
              <label class="field-label" for="m-info">What do you need?</label>
              <textarea
                id="m-info"
                v-model="f.message"
                class="input"
                rows="5"
                maxlength="2000"
                placeholder="e.g. Please send your bust, waist and hip measurements"
              ></textarea>
              <p class="muted mt-2">
                The customer gets this by email and the request moves to needs info.
              </p>
            </template>

            <!-- quote -->
            <template v-else-if="modal.type === 'quote'">
              <div class="grid grid-cols-2 gap-3">
                <div>
                  <label class="field-label" for="m-price">Outfit price (₦)</label>
                  <input
                    id="m-price"
                    v-model="f.price"
                    class="input"
                    inputmode="decimal"
                    placeholder="85000"
                  />
                </div>
                <div>
                  <label class="field-label" for="m-ship">Delivery (₦)</label>
                  <input
                    id="m-ship"
                    v-model="f.shipping"
                    class="input"
                    inputmode="decimal"
                    placeholder="0"
                  />
                </div>
                <div>
                  <label class="field-label" for="m-exp">Quote expires</label>
                  <input
                    id="m-exp"
                    v-model="f.expires"
                    class="input"
                    type="date"
                    :min="todayIso()"
                  />
                </div>
                <div>
                  <label class="field-label" for="m-time">Agreed timeline</label>
                  <input
                    id="m-time"
                    v-model="f.timeline"
                    class="input"
                    maxlength="300"
                    placeholder="3 weeks after payment"
                  />
                </div>
              </div>
              <label class="field-label mt-3" for="m-link">Payment link (optional)</label>
              <input id="m-link" v-model="f.link" class="input" type="url" placeholder="https://" />
              <label class="field-label mt-3" for="m-note">Message (optional)</label>
              <textarea
                id="m-note"
                v-model="f.message"
                class="input"
                rows="3"
                maxlength="2000"
              ></textarea>
              <div class="total-row">
                <span>Total for the customer</span>
                <strong>{{ quotePreview == null ? '-' : naira(quotePreview, 2) }}</strong>
              </div>
              <label class="check"
                ><input v-model="f.notify" type="checkbox" /> Email the quote to the customer</label
              >
            </template>

            <!-- payment -->
            <template v-else-if="modal.type === 'payment'">
              <p class="muted mb-3">
                Recording a payment creates an order from this request. The amount must match the
                quote total.
              </p>
              <div class="grid grid-cols-2 gap-3">
                <div>
                  <label class="field-label" for="m-amt">Amount received (₦)</label>
                  <input id="m-amt" v-model="f.amount" class="input" inputmode="decimal" />
                </div>
                <div>
                  <label class="field-label" for="m-prov">Method</label>
                  <select id="m-prov" v-model="f.provider" class="input">
                    <option value="manual">Manual</option>
                    <option value="bank_transfer">Bank transfer</option>
                    <option value="paystack">Paystack</option>
                    <option value="flutterwave">Flutterwave</option>
                    <option value="cash">Cash</option>
                  </select>
                </div>
              </div>
              <label class="field-label mt-3" for="m-ref">Reference (optional)</label>
              <input
                id="m-ref"
                v-model="f.reference"
                class="input"
                maxlength="120"
                placeholder="Transfer or transaction reference"
              />
              <label class="check"
                ><input v-model="f.notify" type="checkbox" /> Email the customer a payment
                confirmation</label
              >
            </template>

            <!-- edit -->
            <template v-else-if="modal.type === 'edit'">
              <div class="grid grid-cols-2 gap-3">
                <div>
                  <label class="field-label" for="e-qty">Quantity</label>
                  <input
                    id="e-qty"
                    v-model="f.quantity"
                    class="input"
                    type="number"
                    min="1"
                    max="50"
                    :disabled="!!req?.order_id"
                  />
                </div>
                <div>
                  <label class="field-label" for="e-time">Agreed timeline</label>
                  <input id="e-time" v-model="f.timeline" class="input" maxlength="300" />
                </div>
                <div>
                  <label class="field-label" for="e-need">Needed by</label>
                  <input id="e-need" v-model="f.neededBy" class="input" type="date" />
                </div>
                <div>
                  <label class="field-label" for="e-event">Event date</label>
                  <input id="e-event" v-model="f.eventDate" class="input" type="date" />
                </div>
              </div>
              <label class="field-label mt-3" for="e-notes">Internal notes</label>
              <textarea
                id="e-notes"
                v-model="f.notes"
                class="input"
                rows="4"
                maxlength="4000"
              ></textarea>
              <p v-if="req?.order_id" class="muted mt-2">
                Quantity is locked because this request is already an order.
              </p>
            </template>

            <template v-else-if="modal.type === 'revert'">
              <p class="muted mb-3">
                This cancels order {{ detail?.order?.order_number }}, marks its payment as refunded
                and moves the request back to Quoted. It does not send money back, so refund the
                customer through your payment provider.
              </p>
              <label class="field-label" for="m-rev">Reason</label>
              <textarea
                id="m-rev"
                v-model="f.message"
                class="input"
                rows="3"
                maxlength="500"
              ></textarea>
            </template>
            <!-- delete -->
            <template v-else-if="modal.type === 'delete'">
              <p class="muted">
                This permanently removes {{ req?.request_number }}, its files and its activity. This
                can't be undone.
              </p>
            </template>

            <p v-if="modal.error" class="form-error" role="alert">{{ modal.error }}</p>

            <footer class="mt-5 flex justify-end gap-2">
              <button type="button" class="btn-ghost" :disabled="modal.busy" @click="closeModal">
                Cancel
              </button>
              <button
                type="submit"
                :class="
                  modal.type === 'delete' || modal.type === 'revert' || isDanger(modal.to)
                    ? 'btn-danger solid'
                    : 'btn-primary'
                "
                :disabled="modal.busy"
              >
                {{
                  modal.busy
                    ? 'Working'
                    : modal.type === 'delete'
                      ? 'Delete request'
                      : modal.type === 'edit'
                        ? 'Save changes'
                        : modal.type === 'info'
                          ? 'Send request'
                          : modalTitle
                }}
              </button>
            </footer>
          </form>
        </div>
      </Transition>

      <!-- Toasts -->
      <div class="crq-toasts" aria-live="polite">
        <TransitionGroup name="crq-toast">
          <div v-for="t in toasts" :key="t.id" class="crq-toast" :class="`crq-toast-${t.tone}`">
            <Ico :n="t.tone === 'ok' ? 'check' : 'alert'" class="h-4 w-4 shrink-0" />
            <span>{{ t.text }}</span>
          </div>
        </TransitionGroup>
      </div>
    </div>
  </MainLayout>
</template>

<style scoped>
.dash {
  --primary: #c8663f;
  --primary-2: #e8855d;
  --peach: #fdeee6;
  --peach-btn: #f9c3a0;
  --ink: #2b2226;
  --muted: #7a7177;
  --line: #efe8ea;
  --bg: #fcfafb;
  --green: #3e9b54;
  --green-bg: #e6f4ea;
  --red: #e03131;
  --red-bg: #fdecec;
  --amber: #b7791f;
  --amber-bg: #fff4e0;
  --blue: #2f6fbf;
  --blue-bg: #e7f1fd;
  --violet: #5b63d3;
  --violet-bg: #eef0ff;

  color: var(--ink);
  font-feature-settings: 'tnum';
}
.dash :is(button, a, input, select, textarea, tr):focus-visible {
  outline: 2px solid var(--primary-2);
  outline-offset: 2px;
}

/* Typography */
.title {
  font-size: 26px;
  line-height: 1.2;
  font-weight: 650;
  letter-spacing: -0.01em;
}
.muted {
  font-size: 13px;
  color: var(--muted);
}
.card-title {
  font-size: 15px;
  font-weight: 650;
  color: var(--ink);
}
.cell-sub {
  font-size: 12px;
  color: var(--muted);
}
.cell-link {
  font-size: 12.5px;
  color: var(--primary);
  text-decoration: none;
}
.cell-link:hover {
  text-decoration: underline;
}

/* Surfaces */
.card {
  background: #fff;
  border: 1px solid var(--line);
  border-radius: 14px;
  box-shadow:
    0 1px 2px rgba(43, 34, 38, 0.03),
    0 8px 24px -16px rgba(200, 102, 63, 0.18);
}
.notice {
  background: var(--amber-bg);
  color: var(--amber);
  border-radius: 10px;
  padding: 10px 14px;
  font-size: 13px;
}

/* Buttons */
.btn-primary {
  background: var(--peach-btn);
  color: var(--ink);
  font-size: 13px;
  font-weight: 700;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  padding: 11px 22px;
  border-radius: 4px;
  box-shadow: 0 6px 16px -6px rgba(232, 133, 93, 0.6);
  transition:
    transform 0.2s,
    box-shadow 0.2s,
    opacity 0.2s;
}
.btn-primary:hover:not(:disabled) {
  transform: translateY(-1px);
  box-shadow: 0 10px 20px -8px rgba(232, 133, 93, 0.7);
}
.btn-primary:disabled {
  opacity: 0.6;
  cursor: default;
}
.btn-ghost {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  font-size: 13px;
  color: var(--primary);
  background: var(--peach);
  padding: 9px 14px;
  border-radius: 10px;
  transition:
    background 0.2s,
    transform 0.2s;
}
.btn-ghost:hover:not(:disabled) {
  background: #fbe3d6;
  transform: translateY(-1px);
}
.btn-ghost:disabled {
  opacity: 0.6;
  cursor: default;
}
.btn-danger {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  font-size: 13px;
  color: var(--red);
  background: var(--red-bg);
  padding: 9px 14px;
  border-radius: 10px;
  transition:
    background 0.2s,
    transform 0.2s;
}
.btn-danger:hover:not(:disabled) {
  background: #fbdada;
  transform: translateY(-1px);
}
.btn-danger:disabled {
  opacity: 0.6;
  cursor: default;
}
.btn-danger.solid {
  background: var(--red);
  color: #fff;
  font-weight: 600;
}
.btn-danger.solid:hover:not(:disabled) {
  background: #c92a2a;
}
.icon-btn {
  width: 34px;
  height: 34px;
  flex-shrink: 0;
  display: grid;
  place-items: center;
  border-radius: 10px;
  color: var(--muted);
  transition:
    background 0.2s,
    color 0.2s;
}
.icon-btn:hover {
  background: var(--peach);
  color: var(--primary);
}

/* KPI */
.kpi {
  padding: 20px;
  cursor: pointer;
  transition:
    transform 0.25s,
    box-shadow 0.25s,
    border-color 0.25s;
}
.kpi:hover {
  transform: translateY(-3px);
  border-color: #f3d3c3;
  box-shadow: 0 14px 32px -16px rgba(200, 102, 63, 0.35);
}
.kpi-on {
  border-color: var(--primary-2);
  box-shadow: 0 0 0 3px rgba(232, 133, 93, 0.16);
}
.kpi-icon {
  width: 42px;
  height: 42px;
  border-radius: 12px;
  display: grid;
  place-items: center;
}
.tone-primary {
  background: linear-gradient(145deg, #e8855d, #d4663f);
  color: #fff;
  box-shadow: 0 8px 16px -8px rgba(212, 102, 63, 0.7);
}
.tone-peach {
  background: var(--peach);
  color: var(--primary);
}
.tone-amber {
  background: var(--amber-bg);
  color: var(--amber);
}
.tone-green {
  background: var(--green-bg);
  color: var(--green);
}
.tone-red {
  background: var(--red-bg);
  color: var(--red);
}
.kpi-label {
  margin-top: 16px;
  font-size: 12.5px;
  color: var(--muted);
}
.kpi-value {
  margin-top: 2px;
  font-size: 26px;
  font-weight: 700;
  letter-spacing: -0.02em;
  color: var(--ink);
}
.kpi-sub {
  margin-top: 4px;
  font-size: 12px;
  color: var(--muted);
}

/* Search + chips */
.search {
  display: flex;
  align-items: center;
  gap: 8px;
  width: min(100%, 340px);
  padding: 0 12px;
  border: 1px solid var(--line);
  border-radius: 10px;
  background: #fff;
  color: var(--muted);
  transition:
    border-color 0.2s,
    box-shadow 0.2s;
}
.search:focus-within {
  border-color: var(--primary-2);
  box-shadow: 0 0 0 3px rgba(232, 133, 93, 0.18);
}
.search input {
  flex: 1;
  min-width: 0;
  padding: 10px 0;
  font-size: 13.5px;
  color: var(--ink);
  background: transparent;
  outline: none !important;
}
.chips {
  display: flex;
  gap: 8px;
  overflow-x: auto;
  padding-bottom: 4px;
  scrollbar-width: thin;
}
.chip {
  padding: 7px 12px;
  border-radius: 999px;
  font-size: 12.5px;
  white-space: nowrap;
  background: #f6f1f3;
  color: var(--muted);
  transition:
    background 0.2s,
    color 0.2s;
}
.chip:hover {
  background: var(--peach);
}
.chip.on {
  background: var(--peach);
  color: var(--primary);
  font-weight: 600;
  box-shadow: inset 0 0 0 1px #f3d3c3;
}
.chip-count {
  margin-left: 6px;
  font-variant-numeric: tabular-nums;
  opacity: 0.75;
}

/* Table */
.th {
  padding: 12px 12px;
  font-size: 11px;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: var(--muted);
  font-weight: 650;
  background: #fffdfd;
  border-top: 1px solid var(--line);
  border-bottom: 1px solid var(--line);
}
.td {
  padding: 14px 12px;
  font-size: 13.5px;
  border-bottom: 1px solid var(--line);
  vertical-align: middle;
}
.row {
  cursor: pointer;
  transition: background 0.2s;
}
.row:hover {
  background: #fff8f4;
}
.row:last-child .td {
  border-bottom: 0;
}
.due-red {
  color: var(--red);
}
.due-amber {
  color: var(--amber);
}
.reply {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  margin-left: 8px;
  font-size: 11.5px;
  font-weight: 600;
  color: var(--primary);
}

/* Pills */
.pill {
  display: inline-block;
  font-size: 12px;
  font-weight: 500;
  padding: 3px 10px;
  border-radius: 4px;
  text-transform: capitalize;
  white-space: nowrap;
}
.pill-green {
  background: var(--green-bg);
  color: var(--green);
}
.pill-red {
  background: var(--red-bg);
  color: var(--red);
}
.pill-amber {
  background: var(--amber-bg);
  color: var(--amber);
}
.pill-blue {
  background: var(--blue-bg);
  color: var(--blue);
}
.pill-violet {
  background: var(--violet-bg);
  color: var(--violet);
}
.pill-peach {
  background: var(--peach);
  color: var(--primary);
}
.pill-grey {
  background: #f3eff1;
  color: #7a7177;
}

/* Small bits */
.avatar {
  width: 32px;
  height: 32px;
  flex-shrink: 0;
  border-radius: 50%;
  display: grid;
  place-items: center;
  font-size: 11.5px;
  font-weight: 700;
  color: var(--primary);
  background: var(--peach);
}
.avatar.lg {
  width: 44px;
  height: 44px;
  font-size: 14px;
}
.dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: var(--primary-2);
  box-shadow: 0 0 0 4px rgba(232, 133, 93, 0.18);
}

/* Skeleton */
.skeleton {
  position: relative;
  overflow: hidden;
  background: #fff;
}
.skeleton::after {
  content: '';
  position: absolute;
  inset: 0;
  transform: translateX(-100%);
  background: linear-gradient(90deg, transparent, rgba(249, 195, 160, 0.25), transparent);
  animation: shimmer 1.4s infinite;
}
.sk-row {
  display: flex;
  align-items: center;
  gap: 14px;
  padding: 14px 0;
  border-bottom: 1px solid var(--line);
}
.sk-row:last-child {
  border-bottom: 0;
}
.sk-circle {
  width: 32px;
  height: 32px;
  border-radius: 50%;
  background: #f5eff1;
  flex-shrink: 0;
}
.sk-line {
  height: 12px;
  border-radius: 6px;
  background: #f5eff1;
}
.sk-block {
  border-radius: 14px;
  background: #f5eff1;
}
@keyframes shimmer {
  to {
    transform: translateX(100%);
  }
}

/* Drawer */
.crq-overlay {
  position: fixed;
  inset: 0;
  z-index: 50;
  background: rgba(43, 34, 38, 0.35);
  backdrop-filter: blur(2px);
}
.drawer {
  position: fixed;
  top: 0;
  right: 0;
  bottom: 0;
  z-index: 51;
  width: min(580px, 100vw);
  display: flex;
  flex-direction: column;
  background: var(--bg);
  box-shadow: -24px 0 48px -24px rgba(43, 34, 38, 0.35);
}
.drawer-head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 12px;
  padding: 18px 20px;
  background: #fff;
  border-bottom: 1px solid var(--line);
}
.drawer-body {
  flex: 1;
  overflow-y: auto;
  padding: 16px 20px 40px;
  display: flex;
  flex-direction: column;
  gap: 14px;
}
.panel {
  background: #fff;
  border: 1px solid var(--line);
  border-radius: 14px;
  padding: 16px;
}
.panel-title {
  font-size: 13px;
  font-weight: 650;
  margin-bottom: 12px;
  color: var(--ink);
}
.kv {
  display: grid;
  grid-template-columns: 110px 1fr;
  gap: 10px 12px;
  font-size: 13.5px;
}
.kv dt {
  color: var(--muted);
  font-size: 12.5px;
  padding-top: 1px;
}
.kv dd {
  color: var(--ink);
  min-width: 0;
}
.order-link {
  width: 100%;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 12px;
  border-radius: 12px;
  background: #fdf8f6;
  border: 1px solid #f6e9e2;
  transition: background 0.2s;
}
.order-link:hover {
  background: var(--peach);
}

/* Files */
.files {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(104px, 1fr));
  gap: 10px;
}
.file {
  display: block;
  border: 1px solid var(--line);
  border-radius: 12px;
  overflow: hidden;
  background: #fdf8f6;
  transition:
    transform 0.2s,
    border-color 0.2s;
}
.file:hover {
  transform: translateY(-2px);
  border-color: #f3d3c3;
}
.file img,
.file-ph {
  width: 100%;
  height: 88px;
  object-fit: cover;
  display: grid;
  place-items: center;
  color: var(--primary);
}
.file-name {
  display: block;
  padding: 6px 8px;
  font-size: 11.5px;
  color: var(--muted);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

/* Timeline */
.tl {
  position: relative;
  padding-left: 20px;
  display: flex;
  flex-direction: column;
  gap: 16px;
}
.tl::before {
  content: '';
  position: absolute;
  left: 5px;
  top: 6px;
  bottom: 6px;
  width: 2px;
  background: var(--line);
}
.tl li {
  position: relative;
}
.tl-dot {
  position: absolute;
  left: -20px;
  top: 5px;
  width: 12px;
  height: 12px;
  border-radius: 50%;
  border: 2px solid #fff;
  background: #cbbfc4;
}
.dot-blue {
  background: var(--blue);
}
.dot-violet {
  background: var(--violet);
}
.dot-amber {
  background: #e0a030;
}
.dot-green {
  background: var(--green);
}
.tl-note {
  margin: 4px 0;
  padding: 8px 10px;
  border-radius: 8px;
  background: #fdf8f6;
  font-size: 13px;
  white-space: pre-wrap;
}

/* Form + modal */
.input {
  width: 100%;
  border: 1px solid var(--line);
  background: #fff;
  border-radius: 10px;
  padding: 10px 12px;
  font-size: 13.5px;
  color: var(--ink);
  transition:
    border-color 0.2s,
    box-shadow 0.2s;
  resize: vertical;
}
.input:focus {
  outline: none;
  border-color: var(--primary-2);
  box-shadow: 0 0 0 3px rgba(232, 133, 93, 0.18);
}
.input:disabled {
  background: #f8f4f6;
  color: var(--muted);
}
.field-label {
  display: block;
  margin-bottom: 6px;
  font-size: 12px;
  font-weight: 600;
  color: var(--muted);
}
.check {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-top: 14px;
  font-size: 13px;
  color: var(--ink);
}
.check input {
  accent-color: var(--primary);
  width: 16px;
  height: 16px;
}
.total-row {
  display: flex;
  justify-content: space-between;
  margin-top: 14px;
  padding: 12px;
  border-radius: 10px;
  background: var(--peach);
  font-size: 13.5px;
}
.form-error {
  margin-top: 14px;
  padding: 10px 12px;
  border-radius: 10px;
  background: var(--red-bg);
  color: var(--red);
  font-size: 13px;
}
.crq-dlg-wrap {
  position: fixed;
  inset: 0;
  z-index: 70;
  display: grid;
  place-items: center;
  padding: 16px;
  background: rgba(43, 34, 38, 0.4);
}
.crq-dlg {
  width: min(500px, 100%);
  max-height: 92vh;
  overflow-y: auto;
  padding: 22px;
}

/* Toasts */
.crq-toasts {
  position: fixed;
  right: 16px;
  bottom: 16px;
  z-index: 90;
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.crq-toast {
  display: flex;
  align-items: center;
  gap: 10px;
  max-width: 360px;
  padding: 11px 14px;
  border-radius: 10px;
  font-size: 13px;
  color: #fff;
  background: var(--ink);
  box-shadow: 0 12px 24px -10px rgba(43, 34, 38, 0.5);
}
.crq-toast-ok svg {
  color: #8fd7a3;
}
.crq-toast-err svg {
  color: #ff9b9b;
}

/* Transitions */
.fade-enter-active,
.fade-leave-active {
  transition: opacity 0.25s;
}
.fade-enter-from,
.fade-leave-to {
  opacity: 0;
}
.drawer-enter-active,
.drawer-leave-active {
  transition: transform 0.35s cubic-bezier(0.22, 1, 0.36, 1);
}
.drawer-enter-from,
.drawer-leave-to {
  transform: translateX(100%);
}
.pop-enter-active,
.pop-leave-active {
  transition: opacity 0.2s;
}
.pop-enter-active .crq-dlg,
.pop-leave-active .crq-dlg {
  transition: transform 0.25s cubic-bezier(0.22, 1, 0.36, 1);
}
.pop-enter-from,
.pop-leave-to {
  opacity: 0;
}
.pop-enter-from .crq-dlg,
.pop-leave-to .crq-dlg {
  transform: translateY(12px) scale(0.98);
}
.crq-toast-enter-active,
.crq-toast-leave-active {
  transition: all 0.3s;
}
.crq-toast-enter-from,
.crq-toast-leave-to {
  opacity: 0;
  transform: translateY(8px);
}

@media (max-width: 480px) {
  .kv {
    grid-template-columns: 90px 1fr;
  }
}
@media (prefers-reduced-motion: reduce) {
  .kpi,
  .file,
  .btn-ghost,
  .btn-primary,
  .btn-danger,
  .drawer-enter-active,
  .drawer-leave-active,
  .pop-enter-active,
  .pop-leave-active,
  .pop-enter-active .crq-dlg,
  .pop-leave-active .crq-dlg,
  .crq-toast-enter-active,
  .crq-toast-leave-active {
    transition: none;
  }
  .skeleton::after {
    animation: none;
  }
}
</style>
