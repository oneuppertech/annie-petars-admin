<script setup lang="ts">
import { ref, reactive, computed, watch, nextTick, onMounted, onBeforeUnmount } from 'vue'
import { useRouter } from 'vue-router'
import AOS from 'aos'
import 'aos/dist/aos.css'
import '@/styles/dash-ui.css'
import MainLayout from '@/layouts/MainLayout.vue'
import UiIcon from '@/components/UiIcon.vue'
import { OrdersService, downloadCsv } from '@/services/orders'
import { naira, fmtDate, statusMeta, paymentTone, pill, initials, STATUS_OPTIONS } from '@/utils/orders'
import { useAuthStore } from '@/stores/auth'
import type { OrderListItem, OrderStats, OrderStatus } from '@/types/orders'

const ROUTES = { order: (id: string) => `/admin/orders/${id}` }

const router = useRouter()
const auth = useAuthStore()
const canWrite = computed(() => ['owner', 'admin', 'order_manager'].includes(auth.role ?? ''))
const reducedMotion = typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches

/* ---------- state ---------- */
const filters = reactive({ q: '', payment_status: '', from: '', to: '', sort: 'placed_at', dir: 'desc' as 'asc' | 'desc' })
const statusSel = ref<string[]>([])
const page = ref(1)
const limit = 20
const total = ref(0)
const orders = ref<OrderListItem[]>([])
const stats = ref<OrderStats | null>(null)
const loading = ref(true)
const error = ref('')
const selected = ref<string[]>([])
const exporting = ref(false)
const snack = reactive({ show: false, text: '', tone: '' })
let snackTimer: ReturnType<typeof setTimeout>

const toast = (text: string, tone = '') => {
  Object.assign(snack, { show: true, text, tone })
  clearTimeout(snackTimer)
  snackTimer = setTimeout(() => (snack.show = false), 4000)
}
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const errMsg = (e: any) => e?.response?.data?.error ?? e?.response?.data?.message ?? e?.message ?? 'Something went wrong'

const pages = computed(() => Math.max(1, Math.ceil(total.value / limit)))
const params = () => ({ ...filters, status: statusSel.value.join(','), page: page.value, limit })
const hasFilters = computed(() => !!(filters.q || filters.payment_status || filters.from || filters.to || statusSel.value.length))

/* ---------- loading ---------- */
let reqId = 0
async function load() {
  const my = ++reqId
  loading.value = true
  error.value = ''
  try {
    const res = await OrdersService.list(params())
    console.log("orders:", res)
    if (my !== reqId) return
    orders.value = res.orders
    total.value = res.total
    selected.value = []
    nextTick(() => AOS.refreshHard())
  } catch (e) {
    if (my === reqId) error.value = errMsg(e)
  } finally {
    if (my === reqId) loading.value = false
  }
}

async function loadStats() {
  try {
    stats.value = await OrdersService.stats({ from: filters.from, to: filters.to })
  } catch (e) {
    console.error(e)
  }
}

let timer: ReturnType<typeof setTimeout>
watch([filters, statusSel], () => {
  clearTimeout(timer)
  timer = setTimeout(() => {
    loadStats()
    if (page.value !== 1) page.value = 1 // page watcher reloads
    else load()
  }, 350)
}, { deep: true })
watch(page, load)

onMounted(() => {
  AOS.init({ duration: 700, easing: 'ease-out-cubic', once: true, offset: 30, disable: () => reducedMotion })
  load()
  loadStats()
})
onBeforeUnmount(() => { clearTimeout(timer); clearTimeout(snackTimer) })

/* ---------- helpers ---------- */
function toggleSort(col: string) {
  if (filters.sort === col) filters.dir = filters.dir === 'asc' ? 'desc' : 'asc'
  else Object.assign(filters, { sort: col, dir: 'desc' })
}
const sortMark = (col: string) => (filters.sort === col ? (filters.dir === 'asc' ? ' ↑' : ' ↓') : '')
const toggleStatus = (s: string) =>
  (statusSel.value = statusSel.value.includes(s) ? statusSel.value.filter((x) => x !== s) : [...statusSel.value, s])

function resetFilters() {
  Object.assign(filters, { q: '', payment_status: '', from: '', to: '', sort: 'placed_at', dir: 'desc' })
  statusSel.value = []
}

const kpis = computed(() => {
  const t = stats.value?.totals
  return [
    { label: 'Revenue', value: naira(t?.revenue_kobo ?? 0, 0), sub: `${t?.paid_orders ?? 0} paid orders`, icon: 'wallet', tone: 'primary' },
    { label: 'Orders', value: String(t?.orders ?? 0), sub: `${t?.unique_customers ?? 0} customers · ${t?.guest_orders ?? 0} guest`, icon: 'package', tone: 'peach' },
    { label: 'Average order', value: naira(t?.avg_order_kobo ?? 0, 0), sub: 'Paid orders only', icon: 'trend', tone: 'green' },
    { label: 'Refunded', value: naira(t?.refunded_kobo ?? 0, 0), sub: 'In this period', icon: 'undo', tone: 'red' }
  ]
})

const attention = computed(() => {
  const a = stats.value?.attention
  return [
    { label: 'unpaid over 24h', n: a?.unpaid_over_24h ?? 0, status: ['pending_payment'] },
    { label: 'to fulfil over 48h', n: a?.to_fulfil_over_48h ?? 0, status: ['paid', 'processing', 'ready_to_ship'] },
    { label: 'shipped over 7 days', n: a?.shipped_over_7d ?? 0, status: ['shipped'] }
  ].filter((x) => x.n > 0)
})

/* ---------- selection / bulk ---------- */
const allSelected = computed(() => orders.value.length > 0 && selected.value.length === orders.value.length)
const toggleAll = () => (selected.value = allSelected.value ? [] : orders.value.map((o) => o.id))

const bulkOpen = ref(false)
const bulkSaving = ref(false)
const bulk = reactive({ status: '' as OrderStatus | '', provider: '', note: '' })
const commonNext = computed(() => {
  const sel = orders.value.filter((o) => selected.value.includes(o.id))
  if (!sel.length) return [] as OrderStatus[]
  return sel
    .map((o) => o.allowed_next_statuses)
    .reduce((a, b) => a.filter((s) => b.includes(s)))
    .filter((s) => s !== 'refunded') // refunds need a reason + amount: use the order page
})

function openBulk() {
  Object.assign(bulk, { status: '', provider: '', note: '' })
  bulkOpen.value = true
}
async function submitBulk() {
  if (!bulk.status) return
  bulkSaving.value = true
  try {
    const res = await OrdersService.bulkStatus(selected.value, bulk.status, {
      shipping_provider: bulk.status === 'shipped' ? bulk.provider : undefined,
      note: bulk.note || undefined
    })
    bulkOpen.value = false
    const firstErr = res.results?.find((r) => !r.ok)?.error
    toast(res.failed ? `${res.updated} updated, ${res.failed} failed: ${firstErr}` : `${res.updated} order(s) updated`, res.failed ? 'amber' : '')
    await Promise.all([load(), loadStats()])
  } catch (e) {
    toast(errMsg(e), 'red')
  } finally {
    bulkSaving.value = false
  }
}

/* ---------- export ---------- */
async function exportCsv() {
  exporting.value = true
  try {
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { page: _p, limit: _l, ...rest } = params()
    const res = await OrdersService.exportCsv(rest)
    downloadCsv(res)
    toast(res.truncated ? `Exported the first ${res.count} orders (limit reached)` : `Exported ${res.count} orders`, res.truncated ? 'amber' : '')
  } catch (e) {
    toast(errMsg(e), 'red')
  } finally {
    exporting.value = false
  }
}

const open = (id: string) => router.push(ROUTES.order(id))
const refresh = () => { load(); loadStats() }
</script>

<template>
  <MainLayout>
    <div class="dash p-4">
      <!-- Header -->
      <header class="mb-7 flex flex-wrap items-end justify-between gap-4" data-aos="fade-down">
        <div>
          <h1 class="title">Orders</h1>
          <p class="muted mt-1">{{ total.toLocaleString() }} order{{ total === 1 ? '' : 's' }}{{ hasFilters ? ' match your filters' : '' }}</p>
        </div>
        <div class="flex gap-2">
          <button v-if="canWrite" class="btn-ghost" :disabled="exporting" @click="exportCsv">
            <UiIcon name="download" /> <span>{{ exporting ? 'Exporting' : 'Export CSV' }}</span>
          </button>
          <button class="btn-ghost" :disabled="loading" @click="refresh">
            <UiIcon name="refresh" :class="{ 'animate-spin': loading }" /> <span>Refresh</span>
          </button>
        </div>
      </header>

      <!-- KPIs -->
      <section class="mb-4 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <div v-for="(k, i) in kpis" :key="k.label" class="card kpi" data-aos="fade-up" :data-aos-delay="i * 80">
          <div class="kpi-icon" :class="`tone-${k.tone}`"><UiIcon :name="k.icon" :size="20" /></div>
          <p class="kpi-label">{{ k.label }}</p>
          <p class="kpi-value">{{ k.value }}</p>
          <p class="kpi-sub">{{ k.sub }}</p>
        </div>
      </section>

      <div v-if="attention.length" class="mb-6 flex flex-wrap gap-2" data-aos="fade-up">
        <button v-for="a in attention" :key="a.label" class="pill pill-amber" @click="statusSel = a.status">
          {{ a.n }} {{ a.label }}
        </button>
      </div>

      <!-- Filters -->
      <section class="card mb-4 grid gap-4 p-5" data-aos="fade-up">
        <div class="grid gap-3 md:grid-cols-2 lg:grid-cols-4">
          <label class="field lg:col-span-2">
            <span>Search</span>
            <div class="input-icon">
              <UiIcon name="search" />
              <input v-model="filters.q" class="input" placeholder="Order number, email, phone or tracking" />
            </div>
          </label>
          <label class="field">
            <span>Payment</span>
            <select v-model="filters.payment_status" class="input">
              <option value="">All payments</option>
              <option value="paid">Paid</option>
              <option value="unpaid">Unpaid</option>
              <option value="refunded">Refunded</option>
            </select>
          </label>
          <div class="grid grid-cols-2 gap-2">
            <label class="field"><span>From</span><input v-model="filters.from" type="date" class="input" /></label>
            <label class="field"><span>To</span><input v-model="filters.to" type="date" class="input" /></label>
          </div>
        </div>
        <div class="flex flex-wrap items-center gap-2">
          <button v-for="s in STATUS_OPTIONS" :key="s.value" class="chip" :class="{ on: statusSel.includes(s.value) }" @click="toggleStatus(s.value)">
            {{ s.title }}
          </button>
          <button v-if="hasFilters" class="link ml-1" @click="resetFilters">Clear filters</button>
        </div>
      </section>

      <!-- Bulk bar -->
      <div v-if="selected.length && canWrite" class="bulk mb-4">
        <span>{{ selected.length }} selected</span>
        <div class="flex gap-2">
          <button class="chip" @click="selected = []">Clear</button>
          <button class="chip on" :disabled="!commonNext.length" @click="openBulk">Change status</button>
        </div>
      </div>

      <!-- Error -->
      <div v-if="error" class="card mb-4 p-6 text-center" data-aos="zoom-in">
        <div class="kpi-icon tone-red mx-auto mb-3"><UiIcon name="alert" :size="20" /></div>
        <h2 class="card-title">Couldn't load orders</h2>
        <p class="muted mt-1">{{ error }}</p>
        <button class="btn-primary mt-4" @click="refresh">Try again</button>
      </div>

      <!-- Table -->
      <section v-else class="card overflow-hidden" data-aos="fade-up">
        <div v-if="loading && !orders.length" class="space-y-3 p-6">
          <div v-for="n in 6" :key="n" class="card skeleton h-12"></div>
        </div>

        <div v-else-if="!orders.length" class="px-6 py-14 text-center">
          <div class="kpi-icon tone-peach mx-auto mb-3"><UiIcon name="folder" :size="20" /></div>
          <p class="card-title">{{ hasFilters ? 'No orders match these filters' : 'No orders yet' }}</p>
          <p class="muted mt-1">{{ hasFilters ? 'Try a different search or clear the filters.' : 'New orders will show up here as customers check out.' }}</p>
          <button v-if="hasFilters" class="btn-ghost mt-4" @click="resetFilters">Clear filters</button>
        </div>

        <div v-else class="overflow-x-auto">
          <table class="w-full min-w-[820px]">
            <thead>
              <tr>
                <th v-if="canWrite" class="th pl-6" style="width: 44px">
                  <input type="checkbox" class="check" :checked="allSelected" aria-label="Select all" @change="toggleAll" />
                </th>
                <th class="th sortable" :class="{ 'pl-6': !canWrite }" @click="toggleSort('order_number')">Order{{ sortMark('order_number') }}</th>
                <th class="th">Customer</th>
                <th class="th">Items</th>
                <th class="th sortable" @click="toggleSort('total_kobo')">Total{{ sortMark('total_kobo') }}</th>
                <th class="th">Payment</th>
                <th class="th">Status</th>
                <th class="th sortable pr-6 text-right" @click="toggleSort('placed_at')">Placed{{ sortMark('placed_at') }}</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="o in orders" :key="o.id" class="row" tabindex="0" @click="open(o.id)" @keydown.enter="open(o.id)">
                <td v-if="canWrite" class="td pl-6" @click.stop>
                  <input v-model="selected" type="checkbox" class="check" :value="o.id" :aria-label="`Select ${o.order_number}`" />
                </td>
                <td class="td" :class="{ 'pl-6': !canWrite }">
                  <p class="font-medium text-[var(--ink)]">{{ o.order_number }}</p>
                  <p v-if="o.tracking_number" class="cell-sub">{{ o.tracking_number }}</p>
                </td>
                <td class="td">
                  <div class="flex items-center gap-2.5">
                    <span class="avatar">{{ initials(o.customer?.full_name || o.email) }}</span>
                    <div class="min-w-0">
                      <p class="text-[var(--ink)]">{{ o.customer?.full_name || 'Guest' }}</p>
                      <p class="cell-sub">{{ o.email }}</p>
                    </div>
                  </div>
                </td>
                <td class="td" style="max-width: 240px">
                  <p class="truncate text-[var(--ink)]">{{ o.items_preview?.join(', ') }}</p>
                  <p class="cell-sub">{{ o.item_count }} item{{ o.item_count === 1 ? '' : 's' }}</p>
                </td>
                <td class="td font-medium tabular-nums text-[var(--ink)]">{{ naira(o.total_kobo) }}</td>
                <td class="td"><span :class="pill(paymentTone(o.payment_status))">{{ o.payment_status }}</span></td>
                <td class="td"><span :class="pill(statusMeta(o.status).tone)">{{ statusMeta(o.status).label }}</span></td>
                <td class="td cell-sub pr-6 text-right whitespace-nowrap">{{ fmtDate(o.placed_at) }}</td>
              </tr>
            </tbody>
          </table>
        </div>

        <div v-if="pages > 1" class="pager">
          <span class="muted">Page {{ page }} of {{ pages }}</span>
          <div class="flex gap-2">
            <button class="btn-ghost" :disabled="page <= 1" @click="page--">Previous</button>
            <button class="btn-ghost" :disabled="page >= pages" @click="page++">Next</button>
          </div>
        </div>
      </section>

      <!-- Bulk modal -->
      <Transition name="fade">
        <div v-if="bulkOpen" class="modal-back" @click.self="bulkOpen = false">
          <div class="modal card" role="dialog" aria-modal="true">
            <h3 class="card-title">Change status for {{ selected.length }} order{{ selected.length === 1 ? '' : 's' }}</h3>
            <div class="modal-body">
              <label class="field">
                <span>New status</span>
                <select v-model="bulk.status" class="input">
                  <option value="" disabled>Select a status</option>
                  <option v-for="s in commonNext" :key="s" :value="s">{{ statusMeta(s).label }}</option>
                </select>
              </label>
              <label v-if="bulk.status === 'shipped'" class="field"><span>Shipping provider</span><input v-model="bulk.provider" class="input" /></label>
              <label class="field"><span>Note (optional)</span><input v-model="bulk.note" class="input" /></label>
              <p class="cell-sub">Orders that can't make this move are skipped and reported.</p>
            </div>
            <div class="modal-foot">
              <button class="btn-ghost" @click="bulkOpen = false">Cancel</button>
              <button class="btn-primary" :disabled="bulkSaving || !bulk.status || (bulk.status === 'shipped' && !bulk.provider.trim())" @click="submitBulk">
                {{ bulkSaving ? 'Updating' : 'Update' }}
              </button>
            </div>
          </div>
        </div>
      </Transition>

      <Transition name="fade">
        <div v-if="snack.show" class="toast" :class="snack.tone && `toast-${snack.tone}`" role="status">{{ snack.text }}</div>
      </Transition>
    </div>
  </MainLayout>
</template>