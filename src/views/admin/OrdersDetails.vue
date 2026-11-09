<script setup lang="ts">
import { ref, reactive, computed, watch, nextTick, onMounted, onBeforeUnmount } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import AOS from 'aos'
import 'aos/dist/aos.css'
import '@/styles/dash-ui.css'
import MainLayout from '@/layouts/MainLayout.vue'
import UiIcon from '@/components/UiIcon.vue'
import { OrdersService } from '@/services/orders'
import { useAuthStore } from '@/stores/auth'
import { naira, fmtDate, statusMeta, paymentTone, pill, describeTimeline, humanize, relTime } from '@/utils/orders'
import type { OrderDetail, OrderStatus } from '@/types/orders'

const ROUTES = { orders: '/orders' }

const route = useRoute()
const router = useRouter()
const auth = useAuthStore()
const id = computed(() => String(route.params.id))
const canWrite = computed(() => ['owner', 'admin', 'order_manager'].includes(auth.role ?? ''))
const canMoney = computed(() => ['owner', 'admin'].includes(auth.role ?? ''))
const reducedMotion = typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches

const detail = ref<OrderDetail | null>(null)
const loading = ref(true)
const error = ref('')
const saving = ref(false)
const snack = reactive({ show: false, text: '', tone: '' })
let snackTimer: ReturnType<typeof setTimeout>
const toast = (text: string, tone = '') => {
  Object.assign(snack, { show: true, text, tone })
  clearTimeout(snackTimer)
  snackTimer = setTimeout(() => (snack.show = false), 4000)
}
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const errMsg = (e: any) => e?.response?.data?.error ?? e?.response?.data?.message ?? e?.message ?? 'Something went wrong'

const d = computed(() => detail.value)
const o = computed(() => detail.value?.order)
const closed = computed(() => ['cancelled', 'refunded'].includes(o.value?.status ?? ''))
const canShipEdit = computed(() => !!o.value && o.value.status !== 'pending_payment' && !closed.value)
const canPay = computed(() => o.value?.status === 'pending_payment' && o.value?.payment_status !== 'paid')
const canRefund = computed(() => o.value?.payment_status === 'paid' && !!d.value?.allowed_next_statuses?.includes('refunded'))
const nextActions = computed(() => (d.value?.allowed_next_statuses ?? []).filter((s) => s !== 'refunded'))
const mismatch = computed(() => {
  const r = d.value?.reconciliation
  if (!r || !o.value) return []
  const out: string[] = []
  if (!r.subtotal_matches_items) out.push('Subtotal does not match the line items.')
  if (!r.total_matches_parts) out.push('Total does not equal subtotal + shipping − discount.')
  if (o.value.payment_status === 'paid' && !r.payment_matches_total)
    out.push(`Payments received (${naira(r.paid_kobo)}) differ from the order total.`)
  return out
})

async function load() {
  loading.value = true
  error.value = ''
  try {
    detail.value = await OrdersService.get(id.value)
    nextTick(() => AOS.refreshHard())
  } catch (e) {
    error.value = errMsg(e)
  } finally {
    loading.value = false
  }
}
onMounted(() => {
  AOS.init({ duration: 700, easing: 'ease-out-cubic', once: true, offset: 30, disable: () => reducedMotion })
  load()
})
onBeforeUnmount(() => clearTimeout(snackTimer))
watch(id, load)

/* ---------- dialogs ---------- */
type Dlg = '' | 'status' | 'payment' | 'refund' | 'address' | 'shipping' | 'contact' | 'notes'
const dlg = ref<Dlg>('')
const form = reactive({
  status: '' as OrderStatus | '',
  provider: '', tracking: '', note: '', restock: true,
  payType: 'bank_transfer', reference: '',
  amount: '' as string | number, reason: '',
  email: '', phone: '', internal: '', customer: '',
  addr: {} as Record<string, string>
})
const PAY_TYPES = [
  { value: 'bank_transfer', title: 'Bank transfer' },
  { value: 'pos', title: 'POS' },
  { value: 'cash', title: 'Cash' },
  { value: 'other', title: 'Other' }
]
const ADDR_FIELDS = [
  ['recipient_name', 'Recipient name'], ['phone', 'Phone'], ['address_line1', 'Address line 1'],
  ['address_line2', 'Address line 2'], ['city', 'City'], ['state_region', 'State / region'],
  ['postal_code', 'Postal code'], ['country_code', 'Country code']
] as const
const TITLES: Record<Exclude<Dlg, ''>, string> = {
  status: 'Update status', payment: 'Record payment', refund: 'Refund order',
  address: 'Edit shipping address', shipping: 'Shipping & tracking', contact: 'Edit contact', notes: 'Edit notes'
}
const dlgTitle = computed(() =>
  dlg.value === 'status'
    ? form.status === 'cancelled' ? 'Cancel order' : `Mark as ${statusMeta(form.status).label.toLowerCase()}`
    : dlg.value ? TITLES[dlg.value] : ''
)

function openDlg(k: Exclude<Dlg, ''>, next?: OrderStatus) {
  const ord = o.value!
  Object.assign(form, { note: '', reference: '', reason: '', amount: '', restock: !!d.value?.flags.stock_held })
  if (k === 'status') Object.assign(form, { status: next, provider: ord.shipping_provider ?? '', tracking: ord.tracking_number ?? '' })
  if (k === 'shipping') Object.assign(form, { provider: ord.shipping_provider ?? '', tracking: ord.tracking_number ?? '' })
  if (k === 'contact') Object.assign(form, { email: ord.email, phone: ord.phone ?? '' })
  if (k === 'notes') Object.assign(form, { internal: ord.internal_note ?? '', customer: ord.customer_note ?? '' })
  if (k === 'address') {
    form.addr = {}
    for (const [key] of ADDR_FIELDS) form.addr[key] = String(ord.shipping_address?.[key] ?? '')
  }
  dlg.value = k
}

const isClosing = computed(() => form.status === 'cancelled' || form.status === 'refunded')
const toKobo = (v: string | number) => Math.round(Number(v) * 100)
const canSubmit = computed(() => {
  switch (dlg.value) {
    case 'status': return form.status !== 'shipped' || !!form.provider.trim()
    case 'payment': return !!form.reference.trim()
    case 'refund': return !!form.reason.trim() && (form.amount === '' || Number(form.amount) > 0)
    case 'address': return !!form.addr.address_line1?.trim() && !!form.addr.city?.trim()
    case 'contact': return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email)
    default: return true
  }
})
const danger = computed(() => dlg.value === 'refund' || form.status === 'cancelled')

async function run(fn: () => Promise<OrderDetail>, ok: string) {
  saving.value = true
  try {
    detail.value = await fn()
    dlg.value = ''
    toast(ok)
  } catch (e) {
    toast(errMsg(e), 'red')
  } finally {
    saving.value = false
  }
}

function submit() {
  const oid = id.value
  const held = !!d.value?.flags.stock_held
  switch (dlg.value) {
    case 'status':
      return run(() => OrdersService.updateStatus(oid, {
        status: form.status as OrderStatus,
        note: form.note || undefined,
        ...(form.status === 'shipped' || form.tracking || form.provider
          ? { shipping_provider: form.provider.trim() || undefined, tracking_number: form.tracking.trim() || undefined }
          : {}),
        ...(isClosing.value && held ? { restock: form.restock } : {})
      }), `Marked ${statusMeta(form.status).label.toLowerCase()}`)
    case 'payment':
      return run(() => OrdersService.recordPayment(oid, { type: form.payType, reference: form.reference.trim(), note: form.note || undefined }), 'Payment recorded')
    case 'refund':
      return run(() => OrdersService.refund(oid, {
        reason: form.reason.trim(),
        amount_kobo: form.amount === '' ? undefined : toKobo(form.amount),
        reference: form.reference.trim() || undefined,
        ...(held ? { restock: form.restock } : {})
      }), 'Refund recorded')
    case 'address':
      return run(() => OrdersService.updateAddress(oid, { shipping_address: { ...form.addr } }), 'Address updated')
    case 'shipping':
      return run(() => OrdersService.updateShipping(oid, { shipping_provider: form.provider.trim() || null, tracking_number: form.tracking.trim() || null }), 'Shipping updated')
    case 'contact':
      return run(() => OrdersService.updateContact(oid, { email: form.email.trim(), phone: form.phone.trim() }), 'Contact updated')
    case 'notes':
      return run(() => OrdersService.updateNotes(oid, { internal_note: form.internal, customer_note: form.customer }), 'Notes saved')
  }
}

const newNote = ref('')
async function postNote() {
  const text = newNote.value.trim()
  if (!text) return
  await run(() => OrdersService.addNote(id.value, text), 'Note added')
  newNote.value = ''
}

const actClass = (s: string, i: number) => (s === 'cancelled' ? 'btn-danger' : i === 0 ? 'btn-primary' : 'btn-ghost')
const addrLines = computed(() => {
  const a = o.value?.shipping_address
  if (!a) return []
  return [a.recipient_name, a.address_line1, a.address_line2, [a.city, a.state_region, a.postal_code].filter(Boolean).join(', '), a.country_code, a.phone].filter(Boolean) as string[]
})
</script>

<template>
  <MainLayout>
    <div class="dash p-4">
      <button class="link mb-4 inline-flex items-center gap-1.5" @click="router.push(ROUTES.orders)">
        <UiIcon name="back" /> Orders
      </button>

      <!-- Loading -->
      <div v-if="loading && !d" class="space-y-6">
        <div class="card skeleton h-20"></div>
        <div class="grid gap-6 lg:grid-cols-3">
          <div class="card skeleton h-[360px] lg:col-span-2"></div>
          <div class="card skeleton h-[360px]"></div>
        </div>
      </div>

      <!-- Error -->
      <div v-else-if="error && !d" class="card mx-auto max-w-md p-8 text-center" data-aos="zoom-in">
        <div class="kpi-icon tone-red mx-auto mb-4"><UiIcon name="alert" :size="20" /></div>
        <h2 class="card-title">Couldn't load this order</h2>
        <p class="muted mt-1">{{ error }}</p>
        <button class="btn-primary mt-5" @click="load">Try again</button>
      </div>

      <template v-else-if="d && o">
        <!-- Header -->
        <header class="mb-6 flex flex-wrap items-start justify-between gap-4" data-aos="fade-down">
          <div>
            <div class="flex flex-wrap items-center gap-2.5">
              <h1 class="title">{{ o.order_number }}</h1>
              <span :class="pill(statusMeta(o.status).tone)">{{ statusMeta(o.status).label }}</span>
              <span :class="pill(paymentTone(o.payment_status))">{{ o.payment_status }}</span>
            </div>
            <p class="muted mt-1">Placed {{ fmtDate(o.placed_at) }} · Updated {{ relTime(o.updated_at) }}</p>
          </div>

          <div v-if="canWrite" class="flex flex-wrap gap-2">
            <button v-if="canPay && canMoney" class="btn-primary" @click="openDlg('payment')"><UiIcon name="wallet" /> Record payment</button>
            <button v-for="(s, i) in nextActions" :key="s" :class="actClass(s, canPay && canMoney ? i + 1 : i)" @click="openDlg('status', s)">
              {{ s === 'cancelled' ? 'Cancel order' : statusMeta(s).label }}
            </button>
            <button v-if="canRefund && canMoney" class="btn-danger" @click="openDlg('refund')"><UiIcon name="undo" /> Refund</button>
          </div>
        </header>

        <div v-if="mismatch.length" class="notice mb-4" data-aos="fade-in">
          <p v-for="m in mismatch" :key="m">{{ m }}</p>
        </div>
        <div v-if="d.flags.stock_held && !closed" class="notice notice-info mb-4" data-aos="fade-in">
          Stock for this order is reserved and returns automatically if it's cancelled or refunded.
        </div>

        <div class="grid gap-6 lg:grid-cols-3">
          <!-- Left -->
          <div class="space-y-6 lg:col-span-2">
            <section class="card overflow-hidden" data-aos="fade-up">
              <div class="px-6 pt-6 pb-2"><h2 class="card-title">Items</h2><p class="muted">{{ o.items.length }} line{{ o.items.length === 1 ? '' : 's' }}</p></div>
              <ul class="divide-y divide-[var(--line)] px-6">
                <li v-for="i in o.items" :key="i.id" class="flex gap-3 py-4">
                  <img v-if="i.product_snapshot?.image" :src="i.product_snapshot.image as string" :alt="i.product_name" class="thumb" />
                  <div v-else class="thumb"><UiIcon name="package" :size="20" /></div>
                  <div class="min-w-0 flex-1">
                    <p class="text-[14px] font-medium text-[var(--ink)]">{{ i.product_name }}</p>
                    <p class="cell-sub">{{ [i.size, i.colour].filter(Boolean).join(' / ') || 'No variant' }}<span v-if="i.sku"> · {{ i.sku }}</span></p>
                    <p v-if="i.current_stock !== null" class="cell-sub" :style="i.current_stock <= 0 ? 'color: var(--red)' : ''">
                      {{ i.current_stock }} in stock<span v-if="i.variant_active === false"> · variant inactive</span>
                    </p>
                  </div>
                  <div class="text-right">
                    <p class="cell-sub tabular-nums">{{ naira(i.unit_price_kobo) }} × {{ i.quantity }}</p>
                    <p class="text-[14px] font-semibold tabular-nums text-[var(--ink)]">{{ naira(i.line_total_kobo) }}</p>
                  </div>
                </li>
              </ul>
              <dl class="space-y-1.5 border-t border-[var(--line)] px-6 py-4 text-[13.5px]">
                <div class="flex justify-between"><dt class="muted">Subtotal</dt><dd class="tabular-nums">{{ naira(o.subtotal_kobo) }}</dd></div>
                <div class="flex justify-between"><dt class="muted">Shipping</dt><dd class="tabular-nums">{{ naira(o.shipping_kobo) }}</dd></div>
                <div v-if="o.discount_kobo" class="flex justify-between"><dt class="muted">Discount</dt><dd class="tabular-nums">−{{ naira(o.discount_kobo) }}</dd></div>
                <div class="flex justify-between border-t border-[var(--line)] pt-2 text-[15px] font-semibold"><dt>Total</dt><dd class="tabular-nums">{{ naira(o.total_kobo) }}</dd></div>
              </dl>
            </section>

            <section class="card p-6" data-aos="fade-up">
              <h2 class="card-title">Timeline</h2>
              <p class="muted mb-4">Everything that has happened to this order</p>
              <div class="mb-5 flex gap-2">
                <input v-model="newNote" class="input" maxlength="1000" placeholder="Add a note for the team" @keyup.enter="postNote" />
                <button class="btn-ghost" :disabled="saving || !newNote.trim()" @click="postNote"><UiIcon name="plus" /> Add</button>
              </div>
              <ol class="space-y-4">
                <li v-for="t in d.timeline" :key="t.id" class="flex gap-3">
                  <span class="tl-dot"></span>
                  <div>
                    <p class="text-[13.5px] text-[var(--ink)]">{{ describeTimeline(t) }}</p>
                    <p class="cell-sub">{{ fmtDate(t.created_at) }}</p>
                  </div>
                </li>
                <li v-if="!d.timeline.length" class="muted">No activity yet.</li>
              </ol>
            </section>
          </div>

          <!-- Right -->
          <div class="space-y-6">
            <section class="card p-6" data-aos="fade-up">
              <div class="mb-3 flex items-center justify-between">
                <h2 class="card-title">Customer</h2>
                <button v-if="canWrite" class="link" @click="openDlg('contact')">Edit</button>
              </div>
              <p class="text-[14px] font-medium text-[var(--ink)]">{{ o.customer?.full_name ?? 'Guest checkout' }}</p>
              <p class="cell-sub break-all">{{ o.email }}</p>
              <p class="cell-sub">{{ o.phone || 'No phone' }}</p>
              <p v-if="o.customer" class="cell-sub mt-2">{{ o.customer_order_count }} order{{ o.customer_order_count === 1 ? '' : 's' }} in total</p>
            </section>

            <section class="card p-6" data-aos="fade-up">
              <div class="mb-3 flex items-center justify-between">
                <h2 class="card-title">Shipping address</h2>
                <button v-if="canWrite && d.flags.editable_address" class="link" @click="openDlg('address')">Edit</button>
              </div>
              <p v-for="l in addrLines" :key="l" class="text-[13.5px] text-[var(--ink)]">{{ l }}</p>
              <p v-if="!addrLines.length" class="muted">No address</p>
            </section>

            <section class="card p-6" data-aos="fade-up">
              <div class="mb-3 flex items-center justify-between">
                <h2 class="card-title">Delivery</h2>
                <button v-if="canWrite && canShipEdit" class="link" @click="openDlg('shipping')">Edit</button>
              </div>
              <p class="text-[13.5px] text-[var(--ink)]">{{ o.shipping_provider || 'No provider yet' }}</p>
              <p class="cell-sub">{{ o.tracking_number ? `Tracking ${o.tracking_number}` : 'No tracking number' }}</p>
            </section>

            <section class="card p-6" data-aos="fade-up">
              <h2 class="card-title mb-3">Payments</h2>
              <ul class="divide-y divide-[var(--line)]">
                <li v-for="p in d.payments" :key="p.id" class="flex items-start justify-between gap-3 py-3">
                  <div class="min-w-0">
                    <p class="text-[13.5px] text-[var(--ink)]">{{ humanize(p.provider.replace('manual_', 'manual ')) }}</p>
                    <p class="cell-sub break-all">{{ p.provider_reference }} · {{ fmtDate(p.verified_at ?? p.created_at) }}</p>
                  </div>
                  <div class="text-right">
                    <p class="text-[13.5px] font-medium tabular-nums">{{ naira(p.amount_kobo) }}</p>
                    <span :class="pill(paymentTone(p.status))">{{ p.status }}</span>
                  </div>
                </li>
                <li v-if="!d.payments.length" class="muted py-3">No payments yet.</li>
              </ul>
            </section>

            <section class="card p-6" data-aos="fade-up">
              <div class="mb-3 flex items-center justify-between">
                <h2 class="card-title">Notes</h2>
                <button v-if="canWrite" class="link" @click="openDlg('notes')">Edit</button>
              </div>
              <p class="cell-sub">Customer note</p>
              <p class="mb-3 whitespace-pre-line text-[13.5px] text-[var(--ink)]">{{ o.customer_note || '—' }}</p>
              <p class="cell-sub">Internal note</p>
              <p class="whitespace-pre-line text-[13.5px] text-[var(--ink)]">{{ o.internal_note || '—' }}</p>
            </section>
          </div>
        </div>
      </template>

      <!-- Dialog -->
      <Transition name="fade">
        <div v-if="dlg" class="modal-back" @click.self="dlg = ''">
          <div class="modal card" role="dialog" aria-modal="true">
            <h3 class="card-title">{{ dlgTitle }}</h3>
            <div class="modal-body">
              <template v-if="dlg === 'status'">
                <p v-if="form.status === 'cancelled'" class="muted">This can't be undone.</p>
                <template v-if="['shipped', 'processing', 'ready_to_ship'].includes(form.status)">
                  <label class="field"><span>Shipping provider{{ form.status === 'shipped' ? '' : ' (optional)' }}</span><input v-model="form.provider" class="input" /></label>
                  <label class="field"><span>Tracking number (optional)</span><input v-model="form.tracking" class="input" /></label>
                </template>
                <label v-if="isClosing && d?.flags.stock_held" class="check-row"><input v-model="form.restock" type="checkbox" class="check" /> Return reserved items to stock</label>
                <label class="field"><span>Note (optional)</span><input v-model="form.note" class="input" /></label>
              </template>

              <template v-else-if="dlg === 'payment'">
                <p class="muted">Confirms the full {{ naira(o?.total_kobo) }} was received.</p>
                <label class="field"><span>Method</span>
                  <select v-model="form.payType" class="input"><option v-for="p in PAY_TYPES" :key="p.value" :value="p.value">{{ p.title }}</option></select>
                </label>
                <label class="field"><span>Payment reference</span><input v-model="form.reference" class="input" /></label>
                <label class="field"><span>Note (optional)</span><input v-model="form.note" class="input" /></label>
              </template>

              <template v-else-if="dlg === 'refund'">
                <label class="field"><span>Amount in ₦ (leave blank for the full {{ naira(o?.total_kobo) }})</span><input v-model="form.amount" type="number" min="0" step="0.01" class="input" /></label>
                <p class="cell-sub">A partial refund is logged on the timeline and the order stays open. A full refund closes it.</p>
                <label class="field"><span>Reason</span><input v-model="form.reason" class="input" /></label>
                <label class="field"><span>Refund reference (optional)</span><input v-model="form.reference" class="input" /></label>
                <label v-if="d?.flags.stock_held" class="check-row"><input v-model="form.restock" type="checkbox" class="check" /> Return reserved items to stock (full refund)</label>
              </template>

              <template v-else-if="dlg === 'address'">
                <label v-for="[k, label] in ADDR_FIELDS" :key="k" class="field"><span>{{ label }}</span><input v-model="form.addr[k]" class="input" /></label>
              </template>

              <template v-else-if="dlg === 'shipping'">
                <label class="field"><span>Shipping provider</span><input v-model="form.provider" class="input" /></label>
                <label class="field"><span>Tracking number</span><input v-model="form.tracking" class="input" /></label>
              </template>

              <template v-else-if="dlg === 'contact'">
                <label class="field"><span>Email</span><input v-model="form.email" type="email" class="input" /></label>
                <label class="field"><span>Phone</span><input v-model="form.phone" class="input" /></label>
              </template>

              <template v-else-if="dlg === 'notes'">
                <label class="field"><span>Customer note</span><textarea v-model="form.customer" rows="3" class="input"></textarea></label>
                <label class="field"><span>Internal note</span><textarea v-model="form.internal" rows="3" class="input"></textarea></label>
              </template>
            </div>
            <div class="modal-foot">
              <button class="btn-ghost" :disabled="saving" @click="dlg = ''">Close</button>
              <button :class="danger ? 'btn-danger' : 'btn-primary'" :disabled="saving || !canSubmit" @click="submit">
                {{ saving ? 'Saving' : dlg === 'payment' ? 'Record payment' : dlg === 'refund' ? 'Refund' : dlg === 'status' ? 'Confirm' : 'Save changes' }}
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