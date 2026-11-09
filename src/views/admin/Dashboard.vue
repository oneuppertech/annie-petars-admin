<script setup lang="ts">
import { ref, reactive, computed, onMounted, onBeforeUnmount, nextTick } from 'vue'
import { useRouter } from 'vue-router'
import AOS from 'aos'
import 'aos/dist/aos.css'
import ApiService from '@/services/api' // <- adjust to your api service path
import MainLayout from '@/layouts/MainLayout.vue'

/* ------------------------------------------------------------------ */
/* Config                                                              */
/* ------------------------------------------------------------------ */
const ENDPOINT = '/admin-dashboard' // supabase/functions/admin-dashboard
const REFRESH_MS = 60_000

// Adjust to your router
const ROUTES = {
  orders: '/orders',
  order: (id: string) => `/orders/${id}`,
  inventory: '/inventory',
  customRequests: '/custom-requests',
  messages: '/messages'
}

/* ------------------------------------------------------------------ */
/* Types (mirror the edge function response)                           */
/* ------------------------------------------------------------------ */
interface SeriesPoint {
  date: string
  revenue_kobo: number
  orders: number
}
interface OrderRow {
  id: string
  order_number: string
  email: string
  status: string
  payment_status: string
  total_kobo: number
  placed_at: string
  customers?: { id: string; full_name: string } | null
}
interface Overview {
  role: string
  generated_at: string
  orders?: {
    by_status: Record<string, number>
    awaiting_payment: number
    to_fulfil: number
    in_transit: number
    recent: OrderRow[]
  }
  sales?: {
    today: SeriesPoint
    last_7_days: { revenue_kobo: number; orders: number }
    last_30_days: { revenue_kobo: number; orders: number; avg_order_kobo: number }
    series: SeriesPoint[]
    top_products: { product_id: string | null; name: string; units: number; revenue_kobo: number }[]
  }
  payments?: { pending: number }
  catalog?: {
    products: { draft: number; active: number; archived: number }
    low_stock_variants: number
    low_stock_threshold: number
  }
  customers?: { total: number }
  custom_requests?: {
    new: number
    recent: { id: string; request_number: string; name: string; outfit_type: string; status: string; created_at: string }[]
  }
  messages?: {
    new: number
    recent: { id: string; name: string; email: string; enquiry_type: string; status: string; created_at: string }[]
  }
  subscribers?: { subscribed: number }
}

/* ------------------------------------------------------------------ */
/* State                                                               */
/* ------------------------------------------------------------------ */
const router = useRouter()
const data = ref<Overview | null>(null)
const loading = ref(true)
const refreshing = ref(false)
const error = ref('')
const lastUpdated = ref<Date | null>(null)
const barsReady = ref(false)
const chartKey = ref(0)
const hovered = ref<number | null>(null)
const now = ref(Date.now())

const reducedMotion =
  typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches

let poll: ReturnType<typeof setInterval> | null = null
let clock: ReturnType<typeof setInterval> | null = null

/* ------------------------------------------------------------------ */
/* Formatting                                                          */
/* ------------------------------------------------------------------ */
const naira = (kobo: number, decimals = 0) =>
  new Intl.NumberFormat('en-NG', {
    style: 'currency',
    currency: 'NGN',
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals
  }).format((Number(kobo) || 0) / 100)

const compactNaira = (kobo: number) =>
  '₦' +
  new Intl.NumberFormat('en-NG', { notation: 'compact', maximumFractionDigits: 1 }).format(
    (Number(kobo) || 0) / 100
  )

const shortDate = (d: string) =>
  new Date(`${d}T00:00:00`).toLocaleDateString('en-NG', { day: 'numeric', month: 'short' })

const label = (s: string) => s.replace(/_/g, ' ')

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

const greeting = computed(() => {
  const h = new Date().getHours()
  return h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : 'Good evening'
})
const todayLabel = computed(() =>
  new Date().toLocaleDateString('en-NG', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })
)
const updatedLabel = computed(() =>
  lastUpdated.value ? `Updated ${relTime(lastUpdated.value.toISOString())}` : ''
)

/* ------------------------------------------------------------------ */
/* Status tones                                                        */
/* ------------------------------------------------------------------ */
const ORDER_TONE: Record<string, string> = {
  pending_payment: 'amber',
  paid: 'green',
  processing: 'peach',
  ready_to_ship: 'violet',
  shipped: 'blue',
  delivered: 'green',
  cancelled: 'grey',
  refunded: 'red'
}
const PAYMENT_TONE: Record<string, string> = {
  paid: 'green',
  unpaid: 'amber',
  pending: 'amber',
  failed: 'red',
  refunded: 'red'
}
const REQUEST_TONE: Record<string, string> = { new: 'peach' }
const pill = (map: Record<string, string>, s: string) => `pill pill-${map[s] ?? 'grey'}`

const PIPELINE = [
  { key: 'pending_payment', color: '#F2B84B' },
  { key: 'paid', color: '#4FAE6A' },
  { key: 'processing', color: '#E8855D' },
  { key: 'ready_to_ship', color: '#8B8FE8' },
  { key: 'shipped', color: '#5B9BE0' },
  { key: 'delivered', color: '#2F9E5B' },
  { key: 'cancelled', color: '#B8B3B6' },
  { key: 'refunded', color: '#E36B6B' }
]

/* ------------------------------------------------------------------ */
/* Icons (inline, no icon-font dependency)                             */
/* ------------------------------------------------------------------ */
const icons: Record<string, string> = {
  wallet:
    'M19 7V4a1 1 0 0 0-1-1H5a2 2 0 0 0 0 4h15a1 1 0 0 1 1 1v4h-3a2 2 0 0 0 0 4h3a1 1 0 0 0 1-1v-2a1 1 0 0 0-1-1 M3 5v14a2 2 0 0 0 2 2h15a1 1 0 0 0 1-1v-4',
  package:
    'm7.5 4.27 9 5.15 M21 8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16Z M3.3 7 12 12l8.7-5 M12 22V12',
  clock: 'M12 6v6l4 2 M22 12a10 10 0 1 1-20 0 10 10 0 0 1 20 0Z',
  alert:
    'm21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3 M12 9v4 M12 17h.01',
  refresh:
    'M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8 M21 3v5h-5 M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16 M8 16H3v5',
  users:
    'M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2 M22 21v-2a4 4 0 0 0-3-3.87 M16 3.13a4 4 0 0 1 0 7.75 M13 7a4 4 0 1 1-8 0 4 4 0 0 1 8 0Z',
  mail: 'M22 7l-8.97 5.7a1.94 1.94 0 0 1-2.06 0L2 7 M4 4h16a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2Z',
  ruler:
    'M21.3 15.3a2.4 2.4 0 0 1 0 3.4l-2.6 2.6a2.4 2.4 0 0 1-3.4 0L2.7 8.7a2.4 2.4 0 0 1 0-3.4l2.6-2.6a2.4 2.4 0 0 1 3.4 0Z M14.5 12.5l2-2 M11.5 9.5l2-2 M8.5 6.5l2-2 M17.5 15.5l2-2',
  trend: 'M22 7l-8.5 8.5-5-5L2 17 M16 7h6v6',
  arrow: 'M5 12h14 M12 5l7 7-7 7'
}

/* ------------------------------------------------------------------ */
/* Count-up for KPI numbers                                            */
/* ------------------------------------------------------------------ */
const shown = reactive({ revenue: 0, toFulfil: 0, awaiting: 0, lowStock: 0 })
const raf: Record<string, number> = {}

function tween(key: keyof typeof shown, to: number, ms = 900) {
  cancelAnimationFrame(raf[key])
  if (reducedMotion || shown[key] === to) {
    shown[key] = to
    return
  }
  const from = shown[key]
  const t0 = performance.now()
  const step = (t: number) => {
    const p = Math.min(1, (t - t0) / ms)
    shown[key] = from + (to - from) * (1 - Math.pow(1 - p, 3))
    if (p < 1) raf[key] = requestAnimationFrame(step)
  }
  raf[key] = requestAnimationFrame(step)
}

/* ------------------------------------------------------------------ */
/* KPI cards (only the sections the API returned for this role)        */
/* ------------------------------------------------------------------ */
const kpis = computed(() => {
  const d = data.value
  if (!d) return []
  const list: {
    key: string
    label: string
    value: string
    sub: string
    icon: string
    tone: string
    to?: string
  }[] = []

  if (d.sales)
    list.push({
      key: 'revenue',
      label: 'Revenue · 30 days',
      value: naira(shown.revenue),
      sub: `Today ${compactNaira(d.sales.today?.revenue_kobo ?? 0)} · 7d ${compactNaira(d.sales.last_7_days.revenue_kobo)}`,
      icon: 'wallet',
      tone: 'primary',
      to: ROUTES.orders
    })
  if (d.orders) {
    list.push({
      key: 'fulfil',
      label: 'To fulfil',
      value: String(Math.round(shown.toFulfil)),
      sub: `${d.orders.in_transit} in transit`,
      icon: 'package',
      tone: 'peach',
      to: ROUTES.orders
    })
    list.push({
      key: 'awaiting',
      label: 'Awaiting payment',
      value: String(Math.round(shown.awaiting)),
      sub: d.payments ? `${d.payments.pending} pending at provider` : 'Unpaid orders',
      icon: 'clock',
      tone: 'amber',
      to: ROUTES.orders
    })
  }
  if (d.catalog)
    list.push({
      key: 'stock',
      label: 'Low stock variants',
      value: String(Math.round(shown.lowStock)),
      sub: `At or below ${d.catalog.low_stock_threshold} units`,
      icon: 'alert',
      tone: d.catalog.low_stock_variants > 0 ? 'red' : 'green',
      to: ROUTES.inventory
    })
  return list
})

/* ------------------------------------------------------------------ */
/* Revenue chart (pure SVG)                                            */
/* ------------------------------------------------------------------ */
const W = 640
const H = 230
const PAD = { t: 18, r: 14, b: 30, l: 14 }

const series = computed(() => data.value?.sales?.series ?? [])
const maxY = computed(() => Math.max(1, ...series.value.map((s) => s.revenue_kobo)))

const pts = computed(() =>
  series.value.map((d, i) => ({
    d,
    x:
      PAD.l +
      (series.value.length > 1 ? i / (series.value.length - 1) : 0.5) * (W - PAD.l - PAD.r),
    y: PAD.t + (1 - d.revenue_kobo / maxY.value) * (H - PAD.t - PAD.b)
  }))
)

const linePath = computed(() => {
  const p = pts.value
  if (!p.length) return ''
  let path = `M${p[0].x},${p[0].y}`
  for (let i = 1; i < p.length; i++) {
    const cx = (p[i - 1].x + p[i].x) / 2
    path += ` C${cx},${p[i - 1].y} ${cx},${p[i].y} ${p[i].x},${p[i].y}`
  }
  return path
})
const areaPath = computed(() => {
  const p = pts.value
  if (!p.length) return ''
  return `${linePath.value} L${p[p.length - 1].x},${H - PAD.b} L${p[0].x},${H - PAD.b} Z`
})
const gridY = computed(() => [0, 0.25, 0.5, 0.75, 1].map((r) => PAD.t + r * (H - PAD.t - PAD.b)))
const xLabels = computed(() => pts.value.filter((_, i) => i % 7 === 0 || i === pts.value.length - 1))
const hoverPoint = computed(() => (hovered.value === null ? null : pts.value[hovered.value] ?? null))

function onChartMove(e: MouseEvent) {
  const el = e.currentTarget as SVGElement
  const rect = el.getBoundingClientRect()
  const ratio = (e.clientX - rect.left) / rect.width
  const x = ratio * W
  let best = 0
  let dist = Infinity
  pts.value.forEach((p, i) => {
    const dd = Math.abs(p.x - x)
    if (dd < dist) {
      dist = dd
      best = i
    }
  })
  hovered.value = best
}

/* ------------------------------------------------------------------ */
/* Pipeline & top products                                             */
/* ------------------------------------------------------------------ */
const pipeline = computed(() => {
  const by = data.value?.orders?.by_status ?? {}
  const max = Math.max(1, ...PIPELINE.map((p) => by[p.key] ?? 0))
  const total = PIPELINE.reduce((n, p) => n + (by[p.key] ?? 0), 0)
  return {
    total,
    rows: PIPELINE.map((p) => ({
      ...p,
      count: by[p.key] ?? 0,
      pct: ((by[p.key] ?? 0) / max) * 100
    }))
  }
})

const topMax = computed(() =>
  Math.max(1, ...(data.value?.sales?.top_products ?? []).map((p) => p.revenue_kobo))
)

const hasAnySection = computed(() => {
  const d = data.value
  return !!d && !!(d.orders || d.sales || d.catalog || d.customers || d.custom_requests || d.messages)
})

/* ------------------------------------------------------------------ */
/* Loading                                                             */
/* ------------------------------------------------------------------ */
function applyData(d: Overview, replay: boolean) {
  data.value = d
  lastUpdated.value = new Date()
  tween('revenue', d.sales?.last_30_days.revenue_kobo ?? 0)
  tween('toFulfil', d.orders?.to_fulfil ?? 0, 700)
  tween('awaiting', d.orders?.awaiting_payment ?? 0, 700)
  tween('lowStock', d.catalog?.low_stock_variants ?? 0, 700)

  if (replay) {
    barsReady.value = false
    chartKey.value++
  }
  nextTick(() => {
    AOS.refreshHard()
    setTimeout(() => (barsReady.value = true), replay ? 250 : 0)
  })
}

async function load(manual = false) {
  if (manual) refreshing.value = true
  const first = !data.value
  try {
    const d = await ApiService.get<Overview>(ENDPOINT, { params: { resource: 'overview' } })
    error.value = ''
    applyData(d, first || manual)
  } catch (e: any) {
    // Keep stale data on background refresh failures; only surface errors when there's nothing to show
    if (!data.value || manual)
      error.value =
        e?.response?.data?.error ||
        e?.response?.data?.message ||
        e?.message ||
        'Could not load the dashboard'
  } finally {
    loading.value = false
    refreshing.value = false
  }
}

const go = (to?: string) => to && router.push(to)

onMounted(() => {
  AOS.init({
    duration: 700,
    easing: 'ease-out-cubic',
    once: true,
    offset: 30,
    disable: () => reducedMotion
  })
  load()
  poll = setInterval(() => load(), REFRESH_MS)
  clock = setInterval(() => (now.value = Date.now()), 30_000)
})

onBeforeUnmount(() => {
  if (poll) clearInterval(poll)
  if (clock) clearInterval(clock)
  Object.values(raf).forEach(cancelAnimationFrame)
})
</script>

<template>
    <MainLayout>
         <div class="dash p-4">
    <!-- Header -->
    <header class="mb-7 flex flex-wrap items-end justify-between gap-4" data-aos="fade-down">
      <div>
        <h1 class="title">{{ greeting }}</h1>
        <p class="muted mt-1">{{ todayLabel }}</p>
      </div>
      <button class="btn-ghost" :disabled="refreshing" @click="load(true)">
        <svg
          class="h-4 w-4"
          :class="{ 'animate-spin': refreshing }"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          stroke-width="2"
          stroke-linecap="round"
          stroke-linejoin="round"
        >
          <path :d="icons.refresh" />
        </svg>
        <span>{{ refreshing ? 'Refreshing' : updatedLabel || 'Refresh' }}</span>
      </button>
    </header>

    <!-- Loading skeleton -->
    <div v-if="loading && !data" class="space-y-6">
      <div class="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <div v-for="n in 4" :key="n" class="card skeleton h-[148px]"></div>
      </div>
      <div class="grid gap-6 lg:grid-cols-3">
        <div class="card skeleton h-[340px] lg:col-span-2"></div>
        <div class="card skeleton h-[340px]"></div>
      </div>
      <div class="card skeleton h-[300px]"></div>
    </div>

    <!-- Error -->
    <div v-else-if="error && !data" class="card mx-auto max-w-md p-8 text-center" data-aos="zoom-in">
      <div class="kpi-icon tone-red mx-auto mb-4">
        <svg class="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path :d="icons.alert" /></svg>
      </div>
      <h2 class="text-base font-semibold text-[var(--ink)]">Couldn't load the dashboard</h2>
      <p class="muted mt-1">{{ error }}</p>
      <button class="btn-primary mt-5" @click="load(true)">Try again</button>
    </div>

    <!-- Content -->
    <template v-else-if="data">
      <div v-if="error" class="notice mb-5" data-aos="fade-in">{{ error }}</div>

      <div v-if="!hasAnySection" class="card p-10 text-center muted" data-aos="fade-up">
        There's nothing to show for your role yet.
      </div>

      <!-- KPIs -->
      <section v-if="kpis.length" class="mb-6 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <button
          v-for="(k, i) in kpis"
          :key="k.key"
          class="card kpi text-left"
          data-aos="fade-up"
          :data-aos-delay="i * 80"
          @click="go(k.to)"
        >
          <div class="flex items-start justify-between">
            <div class="kpi-icon" :class="`tone-${k.tone}`">
              <svg class="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path :d="icons[k.icon]" /></svg>
            </div>
            <svg class="kpi-arrow h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path :d="icons.arrow" /></svg>
          </div>
          <p class="kpi-label">{{ k.label }}</p>
          <p class="kpi-value">{{ k.value }}</p>
          <p class="kpi-sub">{{ k.sub }}</p>
        </button>
      </section>

      <!-- Chart + pipeline -->
      <section v-if="data.sales || data.orders" class="mb-6 grid gap-6 lg:grid-cols-3">
        <div v-if="data.sales" class="card p-6 lg:col-span-2" data-aos="fade-up" data-aos-delay="100">
          <div class="mb-4 flex flex-wrap items-start justify-between gap-3">
            <div>
              <h2 class="card-title">Revenue</h2>
              <p class="muted">Paid orders, last 30 days</p>
            </div>
            <div class="flex gap-6 text-right">
              <div>
                <p class="stat-label">Orders</p>
                <p class="stat-value">{{ data.sales.last_30_days.orders }}</p>
              </div>
              <div>
                <p class="stat-label">Avg. order</p>
                <p class="stat-value">{{ naira(data.sales.last_30_days.avg_order_kobo) }}</p>
              </div>
            </div>
          </div>

          <div class="relative">
            <svg
              :key="chartKey"
              :viewBox="`0 0 ${W} ${H}`"
              class="chart w-full"
              preserveAspectRatio="none"
              @mousemove="onChartMove"
              @mouseleave="hovered = null"
            >
              <defs>
                <linearGradient id="areaFill" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stop-color="#E8855D" stop-opacity="0.35" />
                  <stop offset="100%" stop-color="#E8855D" stop-opacity="0" />
                </linearGradient>
                <linearGradient id="lineStroke" x1="0" y1="0" x2="1" y2="0">
                  <stop offset="0%" stop-color="#F0A27D" />
                  <stop offset="100%" stop-color="#C8663F" />
                </linearGradient>
              </defs>

              <line
                v-for="y in gridY"
                :key="y"
                :x1="PAD.l"
                :x2="W - PAD.r"
                :y1="y"
                :y2="y"
                stroke="#F1E9EB"
                stroke-width="1"
                stroke-dasharray="3 5"
              />

              <path :d="areaPath" fill="url(#areaFill)" class="chart-area" />
              <path
                :d="linePath"
                fill="none"
                stroke="url(#lineStroke)"
                stroke-width="2.6"
                stroke-linecap="round"
                pathLength="1"
                class="chart-line"
              />

              <template v-if="hoverPoint">
                <line
                  :x1="hoverPoint.x"
                  :x2="hoverPoint.x"
                  :y1="PAD.t"
                  :y2="H - PAD.b"
                  stroke="#E8855D"
                  stroke-opacity="0.4"
                  stroke-width="1"
                />
                <circle :cx="hoverPoint.x" :cy="hoverPoint.y" r="5" fill="#fff" stroke="#D4663F" stroke-width="2.5" />
              </template>

              <text
                v-for="p in xLabels"
                :key="p.d.date"
                :x="p.x"
                :y="H - 8"
                text-anchor="middle"
                class="chart-label"
              >
                {{ shortDate(p.d.date) }}
              </text>
            </svg>

            <Transition name="fade">
              <div
                v-if="hoverPoint"
                class="tooltip"
                :style="{ left: `${(hoverPoint.x / W) * 100}%`, top: `${(hoverPoint.y / H) * 100}%` }"
              >
                <p class="tooltip-date">{{ shortDate(hoverPoint.d.date) }}</p>
                <p class="tooltip-val">{{ naira(hoverPoint.d.revenue_kobo) }}</p>
                <p class="tooltip-sub">{{ hoverPoint.d.orders }} order{{ hoverPoint.d.orders === 1 ? '' : 's' }}</p>
              </div>
            </Transition>
          </div>
        </div>

        <div v-if="data.orders" class="card p-6" data-aos="fade-up" data-aos-delay="180">
          <div class="mb-5 flex items-center justify-between">
            <div>
              <h2 class="card-title">Order pipeline</h2>
              <p class="muted">{{ pipeline.total }} orders total</p>
            </div>
          </div>
          <ul class="space-y-3.5">
            <li v-for="r in pipeline.rows" :key="r.key">
              <div class="mb-1.5 flex items-center justify-between text-[13px]">
                <span class="capitalize text-[var(--ink)]">{{ label(r.key) }}</span>
                <span class="font-medium tabular-nums text-[var(--ink)]">{{ r.count }}</span>
              </div>
              <div class="bar-track">
                <div
                  class="bar-fill"
                  :style="{ width: barsReady ? `${Math.max(r.pct, r.count ? 4 : 0)}%` : '0%', background: r.color }"
                ></div>
              </div>
            </li>
          </ul>
        </div>
      </section>

      <!-- Recent orders + top products -->
      <section v-if="data.orders || data.sales?.top_products?.length" class="mb-6 grid gap-6 lg:grid-cols-3">
        <div v-if="data.orders" class="card overflow-hidden lg:col-span-2" data-aos="fade-up">
          <div class="flex items-center justify-between px-6 pt-6 pb-4">
            <div>
              <h2 class="card-title">Recent orders</h2>
              <p class="muted">Latest activity across the store</p>
            </div>
            <button class="link" @click="go(ROUTES.orders)">View all</button>
          </div>
          <div class="overflow-x-auto">
            <table class="w-full min-w-[640px] text-left">
              <thead>
                <tr>
                  <th class="th pl-6">Order</th>
                  <th class="th">Customer</th>
                  <th class="th">Total</th>
                  <th class="th">Payment</th>
                  <th class="th">Status</th>
                  <th class="th pr-6 text-right">Placed</th>
                </tr>
              </thead>
              <tbody>
                <tr
                  v-for="(o, i) in data.orders.recent"
                  :key="o.id"
                  class="row"
                  data-aos="fade-up"
                  :data-aos-delay="i * 50"
                  @click="go(ROUTES.order(o.id))"
                >
                  <td class="td pl-6">
                    <p class="font-medium text-[var(--ink)]">{{ o.order_number }}</p>
                    <p class="cell-sub">{{ o.email }}</p>
                  </td>
                  <td class="td">
                    <div class="flex items-center gap-2.5">
                      <span class="avatar">{{ initials(o.customers?.full_name || o.email) }}</span>
                      <span class="text-[var(--ink)]">{{ o.customers?.full_name || 'Guest' }}</span>
                    </div>
                  </td>
                  <td class="td font-medium tabular-nums text-[var(--ink)]">{{ naira(o.total_kobo, 2) }}</td>
                  <td class="td"><span :class="pill(PAYMENT_TONE, o.payment_status)">{{ label(o.payment_status) }}</span></td>
                  <td class="td"><span :class="pill(ORDER_TONE, o.status)">{{ label(o.status) }}</span></td>
                  <td class="td pr-6 text-right cell-sub">{{ relTime(o.placed_at) }}</td>
                </tr>
                <tr v-if="!data.orders.recent.length">
                  <td colspan="6" class="td py-10 text-center muted">No orders yet</td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>

        <div class="card p-6" data-aos="fade-up" data-aos-delay="100">
          <div class="mb-5">
            <h2 class="card-title">Top products</h2>
            <p class="muted">By revenue, last 30 days</p>
          </div>
          <ul class="space-y-4">
            <li v-for="(p, i) in data.sales.top_products" :key="p.product_id ?? p.name">
              <div class="flex items-center gap-3">
                <span class="rank">{{ i + 1 }}</span>
                <div class="min-w-0 flex-1">
                  <p class="truncate text-[14px] font-medium text-[var(--ink)]">{{ p.name }}</p>
                  <p class="cell-sub">{{ p.units }} unit{{ p.units === 1 ? '' : 's' }}</p>
                </div>
                <p class="text-[13px] font-semibold tabular-nums text-[var(--ink)]">{{ compactNaira(p.revenue_kobo) }}</p>
              </div>
              <div class="bar-track mt-2 ml-9">
                <div class="bar-fill" :style="{ width: barsReady ? `${(p.revenue_kobo / topMax) * 100}%` : '0%', background: 'linear-gradient(90deg,#F0A27D,#D4663F)' }"></div>
              </div>
            </li>
          </ul>
        </div>
      </section>

      <!-- Bottom row -->
      <section class="grid gap-6 lg:grid-cols-3">
        <div v-if="data.custom_requests" class="card p-6" data-aos="fade-up">
          <div class="mb-4 flex items-start justify-between">
            <div class="flex items-center gap-3">
              <div class="kpi-icon tone-peach sm">
                <svg class="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path :d="icons.ruler" /></svg>
              </div>
              <div>
                <h2 class="card-title">Custom requests</h2>
                <p class="muted">{{ data.custom_requests.new }} new</p>
              </div>
            </div>
            <button class="link" @click="go(ROUTES.customRequests)">View all</button>
          </div>
          <ul class="divide-y divide-[var(--line)]">
            <li v-for="r in data.custom_requests.recent.slice(0, 5)" :key="r.id" class="flex items-center justify-between gap-3 py-3">
              <div class="min-w-0">
                <p class="truncate text-[14px] font-medium text-[var(--ink)]">{{ r.name }}</p>
                <p class="cell-sub truncate">{{ r.outfit_type }} · {{ relTime(r.created_at) }}</p>
              </div>
              <span :class="pill(REQUEST_TONE, r.status)">{{ label(r.status) }}</span>
            </li>
            <li v-if="!data.custom_requests.recent.length" class="py-8 text-center muted">No requests yet</li>
          </ul>
        </div>

        <div v-if="data.messages" class="card p-6" data-aos="fade-up" data-aos-delay="100">
          <div class="mb-4 flex items-start justify-between">
            <div class="flex items-center gap-3">
              <div class="kpi-icon tone-peach sm">
                <svg class="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path :d="icons.mail" /></svg>
              </div>
              <div>
                <h2 class="card-title">Messages</h2>
                <p class="muted">{{ data.messages.new }} unread</p>
              </div>
            </div>
            <button class="link" @click="go(ROUTES.messages)">View all</button>
          </div>
          <ul class="divide-y divide-[var(--line)]">
            <li v-for="m in data.messages.recent" :key="m.id" class="flex items-center gap-3 py-3">
              <span class="avatar">{{ initials(m.name) }}</span>
              <div class="min-w-0 flex-1">
                <p class="truncate text-[14px] font-medium text-[var(--ink)]">{{ m.name }}</p>
                <p class="cell-sub truncate">{{ m.enquiry_type }} · {{ relTime(m.created_at) }}</p>
              </div>
              <span v-if="m.status === 'new'" class="dot"></span>
            </li>
            <li v-if="!data.messages.recent.length" class="py-8 text-center muted">Inbox is clear</li>
          </ul>
        </div>

        <div class="card p-6" data-aos="fade-up" data-aos-delay="200">
          <h2 class="card-title mb-4">Store snapshot</h2>
          <div class="grid grid-cols-2 gap-3">
            <div v-if="data.customers" class="snap">
              <svg class="snap-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path :d="icons.users" /></svg>
              <p class="snap-val">{{ data.customers.total }}</p>
              <p class="snap-label">Customers</p>
            </div>
            <div v-if="data.subscribers" class="snap">
              <svg class="snap-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path :d="icons.mail" /></svg>
              <p class="snap-val">{{ data.subscribers.subscribed }}</p>
              <p class="snap-label">Subscribers</p>
            </div>
            <template v-if="data.catalog">
              <div class="snap">
                <svg class="snap-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path :d="icons.package" /></svg>
                <p class="snap-val">{{ data.catalog.products.active }}</p>
                <p class="snap-label">Active products</p>
              </div>
              <div class="snap">
                <svg class="snap-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path :d="icons.trend" /></svg>
                <p class="snap-val">{{ data.catalog.products.draft }}</p>
                <p class="snap-label">Drafts</p>
              </div>
            </template>
          </div>
        </div>
      </section>
    </template>
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

/* Typography */
.eyebrow {
  font-size: 11px;
  letter-spacing: 0.16em;
  text-transform: uppercase;
  color: var(--muted);
  font-weight: 600;
}
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

/* Surfaces */
.card {
  background: #fff;
  border: 1px solid var(--line);
  border-radius: 14px;
  box-shadow: 0 1px 2px rgba(43, 34, 38, 0.03), 0 8px 24px -16px rgba(200, 102, 63, 0.18);
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
  transition: transform 0.2s, box-shadow 0.2s;
}
.btn-primary:hover {
  transform: translateY(-1px);
  box-shadow: 0 10px 20px -8px rgba(232, 133, 93, 0.7);
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
  transition: background 0.2s, transform 0.2s;
}
.btn-ghost:hover:not(:disabled) {
  background: #fbe3d6;
  transform: translateY(-1px);
}
.btn-ghost:disabled {
  opacity: 0.7;
  cursor: default;
}
.link {
  font-size: 13px;
  font-weight: 600;
  color: var(--primary);
  padding: 4px 2px;
  position: relative;
}
.link::after {
  content: '';
  position: absolute;
  left: 0;
  right: 0;
  bottom: 0;
  height: 2px;
  background: var(--primary);
  transform: scaleX(0);
  transform-origin: left;
  transition: transform 0.25s;
}
.link:hover::after {
  transform: scaleX(1);
}

/* KPI */
.kpi {
  padding: 20px;
  cursor: pointer;
  transition: transform 0.25s, box-shadow 0.25s, border-color 0.25s;
}
.kpi:hover {
  transform: translateY(-3px);
  border-color: #f3d3c3;
  box-shadow: 0 14px 32px -16px rgba(200, 102, 63, 0.35);
}
.kpi-arrow {
  color: #cbbfc4;
  transition: transform 0.25s, color 0.25s;
}
.kpi:hover .kpi-arrow {
  color: var(--primary);
  transform: translateX(3px);
}
.kpi-icon {
  width: 42px;
  height: 42px;
  border-radius: 12px;
  display: grid;
  place-items: center;
}
.kpi-icon.sm {
  width: 36px;
  height: 36px;
  border-radius: 10px;
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

/* Stats */
.stat-label {
  font-size: 11px;
  text-transform: uppercase;
  letter-spacing: 0.1em;
  color: var(--muted);
}
.stat-value {
  font-size: 16px;
  font-weight: 650;
}

/* Chart */
.chart {
  height: 230px;
  display: block;
  cursor: crosshair;
}
.chart-label {
  font-size: 10.5px;
  fill: #a69ca1;
}
.chart-line {
  stroke-dasharray: 1;
  stroke-dashoffset: 1;
  animation: draw 1.4s 0.15s ease-out forwards;
}
.chart-area {
  opacity: 0;
  animation: fadein 0.9s 0.9s ease-out forwards;
}
@keyframes draw {
  to {
    stroke-dashoffset: 0;
  }
}
@keyframes fadein {
  to {
    opacity: 1;
  }
}
.tooltip {
  position: absolute;
  transform: translate(-50%, calc(-100% - 14px));
  background: var(--ink);
  color: #fff;
  border-radius: 10px;
  padding: 8px 12px;
  pointer-events: none;
  white-space: nowrap;
  box-shadow: 0 12px 24px -10px rgba(43, 34, 38, 0.5);
}
.tooltip-date {
  font-size: 11px;
  opacity: 0.65;
}
.tooltip-val {
  font-size: 14px;
  font-weight: 700;
}
.tooltip-sub {
  font-size: 11px;
  color: var(--peach-btn);
}
.fade-enter-active,
.fade-leave-active {
  transition: opacity 0.15s;
}
.fade-enter-from,
.fade-leave-to {
  opacity: 0;
}

/* Bars */
.bar-track {
  height: 7px;
  border-radius: 999px;
  background: #f5eff1;
  overflow: hidden;
}
.bar-fill {
  height: 100%;
  border-radius: 999px;
  transition: width 1s cubic-bezier(0.22, 1, 0.36, 1);
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
.rank {
  width: 24px;
  height: 24px;
  flex-shrink: 0;
  border-radius: 8px;
  display: grid;
  place-items: center;
  font-size: 12px;
  font-weight: 700;
  color: var(--primary);
  background: var(--peach);
}
.dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: var(--primary-2);
  box-shadow: 0 0 0 4px rgba(232, 133, 93, 0.18);
}
.snap {
  padding: 14px;
  border-radius: 12px;
  background: #fdf8f6;
  border: 1px solid #f6e9e2;
  transition: transform 0.25s, background 0.25s;
}
.snap:hover {
  transform: translateY(-2px);
  background: var(--peach);
}
.snap-icon {
  width: 18px;
  height: 18px;
  color: var(--primary);
}
.snap-val {
  margin-top: 10px;
  font-size: 22px;
  font-weight: 700;
  letter-spacing: -0.02em;
}
.snap-label {
  font-size: 12px;
  color: var(--muted);
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
@keyframes shimmer {
  to {
    transform: translateX(100%);
  }
}

@media (prefers-reduced-motion: reduce) {
  .chart-line,
  .chart-area {
    animation: none;
    stroke-dashoffset: 0;
    opacity: 1;
  }
  .bar-fill,
  .kpi,
  .snap {
    transition: none;
  }
}
</style>