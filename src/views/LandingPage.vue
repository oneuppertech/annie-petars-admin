<script setup>
import { ref, computed, watch, onMounted, onBeforeUnmount } from 'vue'
import ApiService from '@/services/api'

/* ---------- Config ---------- */
const LANDING_URL = 'https://anniepetars.com'
const WHATSAPP = 'https://wa.me/2348084903580'
const PAGE_SIZE = 24
const LS_CART = 'ap_cart_v1'

/* ---------- State ---------- */
const collections = ref([])
const products = ref([])
const loading = ref(true)
const loadingMore = ref(false)
const loadError = ref(false)
const hasMore = ref(false)
const offset = ref(0)

const searchQuery = ref('')
const activeCollection = ref('')

const cartOpen = ref(false)
const cart = ref([])

/* Two "pages": list and product, driven by the URL hash so the back button works */
const route = ref({ name: 'list', slug: '' })

const pickSize = ref('')
const pickColour = ref('')
const pickQty = ref(1)
const activeImage = ref(0)
const pageError = ref('')

const toast = ref('')
let toastTimer
let searchTimer
let requestId = 0

/* ---------- Helpers ---------- */
const formatKobo = (kobo) =>
  new Intl.NumberFormat('en-NG', {
    style: 'currency',
    currency: 'NGN',
    minimumFractionDigits: 2
  }).format((kobo || 0) / 100)

const text = (row, ...keys) => {
  for (const k of keys) {
    const v = row?.[k]
    if (typeof v === 'string' && v.trim()) return v
  }
  return ''
}
const num = (row, ...keys) => {
  for (const k of keys) {
    const v = row?.[k]
    if (v !== null && v !== undefined && v !== '' && Number.isFinite(Number(v))) return Number(v)
  }
  return null
}
const slugify = (s) =>
  String(s || '')
    .toLowerCase()
    .replace(/['’]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')

function normalizeImages(row) {
  const raw = row.images || row.product_images || []
  const list = Array.isArray(raw) ? raw : []
  const mapped = list
    .map((i) =>
      typeof i === 'string'
        ? { url: i, type: 'image', primary: false, order: 0 }
        : {
            url: text(i, 'image_url', 'url'),
            type: i.media_type === 'video' ? 'video' : 'image',
            primary: !!i.is_primary,
            order: Number(i.sort_order || 0)
          }
    )
    .filter((i) => i.url)
    .sort((a, b) => Number(b.primary) - Number(a.primary) || a.order - b.order)
    .map(({ url, type }) => ({ url, type }))
  const single = text(row, 'image_url', 'image', 'primary_image')
  if (!mapped.length && single) mapped.push({ url: single, type: 'image' })
  return mapped
}

function normalizeProduct(row, index) {
  const variantsRaw = row.variants || row.product_variants || []

  const variants = (Array.isArray(variantsRaw) ? variantsRaw : [])
    .filter((v) => v.is_active !== false)
    .map((v) => ({
      id: v.id,
      size: v.size || '',
      colour: v.colour || v.color || '',
      price: num(v, 'price_kobo'),
      stock: num(v, 'stock_quantity') ?? 0
    }))

  const col = row.collection && typeof row.collection === 'object' ? row.collection : {}

  const colName = text(col, 'name') || text(row, 'collection_name')
  const images = normalizeImages(row)
  const name = text(row, 'name', 'title') || 'AnniePetars piece'

  return {
    id: row.id || `p-${index}`,
    name,
    slug: text(row, 'slug') || slugify(name),
    short: text(row, 'short_description'),
    description: text(row, 'description'),
    fabric: text(row, 'fabric'),
    care: text(row, 'care_instructions'),
    price: num(row, 'price_kobo') ?? Math.round((num(row, 'price') || 0) * 100),
    compareAt: num(row, 'compare_at_price_kobo'),

    // Correct image mapping
    images,
    image: images[0]?.url || '',

    collectionName: colName,
    collectionSlug: text(col, 'slug') || text(row, 'collection_slug') || slugify(colName),
    isNew: !!row.is_new_arrival,
    customisable: !!row.is_customisable,
    backorder: !!row.allow_backorder,
    variants
  }
}

const hasVariants = (p) => p.variants.length > 0
const productInStock = (p) => !hasVariants(p) || p.backorder || p.variants.some((v) => v.stock > 0)
const onSale = (p) => p.compareAt && p.compareAt > p.price
const needsChoice = (p) =>
  hasVariants(p) && (p.variants.length > 1 || p.variants[0].size || p.variants[0].colour)

/* ---------- Data ---------- */
function buildQuery(extraOffset = 0) {
  const params = new URLSearchParams()
  if (activeCollection.value) params.set('collection', activeCollection.value)
  if (searchQuery.value.trim()) params.set('q', searchQuery.value.trim())
  params.set('limit', String(PAGE_SIZE))
  params.set('offset', String(extraOffset))
  return params.toString()
}

async function loadCatalog({ append = false } = {}) {
  const id = ++requestId
  if (append) loadingMore.value = true
  else {
    loading.value = true
    offset.value = 0
  }
  loadError.value = false
  try {
    const res = await ApiService.get(`/catalog-public?${buildQuery(append ? offset.value : 0)}`)
    console.log('catalog:', res)
    if (id !== requestId) return
    const root = Array.isArray(res) ? { products: res } : res?.data || res || {}
    if (Array.isArray(root.collections) && root.collections.length) {
      collections.value = root.collections.map((c) => ({ id: c.id, slug: c.slug, name: c.name }))
    }
    const rows = (root.products || []).map(normalizeProduct)
    products.value = append ? [...products.value, ...rows] : rows
    offset.value = products.value.length
    hasMore.value = rows.length === PAGE_SIZE
  } catch (e) {
    if (id !== requestId) return
    console.error('Unable to load catalogue:', e)
    loadError.value = true
    if (!append) products.value = []
    hasMore.value = false
  } finally {
    if (id === requestId) {
      loading.value = false
      loadingMore.value = false
    }
  }
}

watch(searchQuery, () => {
  clearTimeout(searchTimer)
  searchTimer = setTimeout(() => loadCatalog(), 350)
})
watch(activeCollection, () => loadCatalog())

const filtersActive = computed(() => !!(activeCollection.value || searchQuery.value))
function resetFilters() {
  activeCollection.value = ''
  searchQuery.value = ''
}

/* ---------- Routing (hash based) ---------- */
function parseHash() {
  const m = location.hash.match(/^#\/product\/(.+)$/)
  route.value = m ? { name: 'product', slug: decodeURIComponent(m[1]) } : { name: 'list', slug: '' }
  window.scrollTo({ top: 0 })
}
function goProduct(p) {
  location.hash = `#/product/${encodeURIComponent(p.slug || p.id)}`
}
function goList() {
  history.pushState('', document.title, location.pathname + location.search)
  parseHash()
}

const selected = computed(() =>
  route.value.name === 'product'
    ? products.value.find(
        (p) => p.slug === route.value.slug || String(p.id) === route.value.slug
      ) || null
    : null
)

watch(
  selected,
  (p) => {
    if (!p) return
    activeImage.value = 0
    pickQty.value = 1
    pageError.value = ''
    const first = p.variants.find((v) => v.stock > 0) || p.variants[0]
    pickSize.value = first?.size || ''
    pickColour.value = first?.colour || ''
  },
  { immediate: true }
)

/* ---------- Product page selection ---------- */
const sizes = computed(() =>
  selected.value ? [...new Set(selected.value.variants.map((v) => v.size).filter(Boolean))] : []
)
const colours = computed(() =>
  selected.value ? [...new Set(selected.value.variants.map((v) => v.colour).filter(Boolean))] : []
)
const matchedVariant = computed(() => {
  const p = selected.value
  if (!p || !hasVariants(p)) return null
  return (
    p.variants.find(
      (v) =>
        (!sizes.value.length || v.size === pickSize.value) &&
        (!colours.value.length || v.colour === pickColour.value)
    ) || null
  )
})
const pagePrice = computed(() => selected.value?.price ?? 0)
const pageStock = computed(() => {
  const p = selected.value
  if (!p) return 0
  if (!hasVariants(p)) return 99
  return matchedVariant.value ? matchedVariant.value.stock : 0
})
const pageSoldOut = computed(() => {
  const p = selected.value
  if (!p || p.backorder) return false
  return hasVariants(p) && !!matchedVariant.value && matchedVariant.value.stock <= 0
})
const maxPickQty = computed(() => (selected.value?.backorder ? 99 : Math.max(pageStock.value, 1)))

function addFromPage() {
  const p = selected.value
  if (!p) return
  if (hasVariants(p)) {
    if ((sizes.value.length && !pickSize.value) || (colours.value.length && !pickColour.value)) {
      pageError.value = 'Choose your size and colour first.'
      return
    }
    if (!matchedVariant.value) {
      pageError.value = 'That combination is not available.'
      return
    }
    if (pageSoldOut.value) {
      pageError.value = 'That option is sold out.'
      return
    }
  } else if (!productInStock(p)) return
  addToCart(p, matchedVariant.value, pickQty.value)
  cartOpen.value = true
}

/* ---------- Cart ---------- */
const cartCount = computed(() => cart.value.reduce((s, i) => s + i.qty, 0))
const cartSubtotal = computed(() => cart.value.reduce((s, i) => s + i.price * i.qty, 0))
const shipping = 0
const cartTotal = computed(() => cartSubtotal.value + shipping)

function addToCart(p, variant, qty) {
  const key = `${p.id}:${variant?.id || 'base'}`
  const max = p.backorder || !variant ? 99 : Math.max(variant.stock, 0)
  const existing = cart.value.find((i) => i.key === key)
  if (existing) {
    existing.qty = Math.min(existing.qty + qty, max || existing.qty + qty)
  } else {
    cart.value.push({
      key,
      productId: p.id,
      variantId: variant?.id || null,
      name: p.name,
      image: p.image,
      size: variant?.size || '',
      colour: variant?.colour || '',
      price: variant?.price ?? p.price,
      qty,
      max
    })
  }
  showToast(`${p.name} added to your cart`)
}

function changeQty(key, delta) {
  const item = cart.value.find((i) => i.key === key)
  if (!item) return
  const next = item.qty + delta
  if (next <= 0) return removeItem(key)
  if (item.max && next > item.max) {
    showToast('That is all we have in stock')
    return
  }
  item.qty = next
}
const removeItem = (key) => (cart.value = cart.value.filter((i) => i.key !== key))
const emptyCart = () => (cart.value = [])

/* Grid-card steppers */
const qtyInCart = (p) =>
  cart.value.filter((i) => i.productId === p.id).reduce((s, i) => s + i.qty, 0)
function cardPlus(p) {
  if (!productInStock(p)) return
  if (needsChoice(p)) return goProduct(p)
  addToCart(p, p.variants[0] || null, 1)
}
function cardMinus(p) {
  const lines = cart.value.filter((i) => i.productId === p.id)
  if (lines.length) changeQty(lines[lines.length - 1].key, -1)
}

function beginCheckout() {
  // TODO: POST cart (variant ids + quantities only, never prices) to a create-order edge function.
  // The server should re-price from the database, create the order + payment session,
  // and return a payment URL to redirect to.
  showToast('Checkout is not connected yet')
}

const track = ref(null)
const onScroll = () => {
  const t = track.value
  if (t) activeImage.value = Math.round(t.scrollLeft / t.clientWidth)
}
const goTo = (i) => track.value?.scrollTo({ left: i * track.value.clientWidth, behavior: 'smooth' })
const slide = (d) =>
  goTo(Math.min(Math.max(activeImage.value + d, 0), selected.value.images.length - 1))
const pageOnSale = computed(
  () => !!selected.value?.compareAt && selected.value.compareAt > pagePrice.value
)

/* ---------- UI plumbing ---------- */
function showToast(msg) {
  toast.value = msg
  clearTimeout(toastTimer)
  toastTimer = setTimeout(() => (toast.value = ''), 2400)
}
function safeLoad(key) {
  try {
    return JSON.parse(localStorage.getItem(key) || '[]')
  } catch {
    return []
  }
}
watch(
  cart,
  (v) => {
    try {
      localStorage.setItem(LS_CART, JSON.stringify(v))
    } catch {}
  },
  { deep: true }
)

onMounted(() => {
  cart.value = safeLoad(LS_CART)
  parseHash()
  window.addEventListener('hashchange', parseHash)
  loadCatalog()
})
onBeforeUnmount(() => {
  window.removeEventListener('hashchange', parseHash)
  clearTimeout(toastTimer)
  clearTimeout(searchTimer)
})
</script>

<template>
  <v-layout class="ap-layout">
    <v-main class="ap min-h-screen bg-white text-[#2A1B16] antialiased">
      <!-- HEADER -->
      <header class="mx-auto flex max-w-6xl items-start justify-between gap-4 px-5 pb-2 pt-5">
        <a
          href="#"
          class="flex flex-col gap-1"
          aria-label="AnniePetars shop home"
          @click.prevent="goList"
        >
          <span class="flex items-center gap-3">
            <span
              class="flex h-10 w-10 items-center justify-center rounded-full bg-[#FFE6D6] font-display text-sm"
              >AP</span
            >
            <span class="font-semibold">AnniePetars</span>
          </span>
        </a>

        <div class="flex items-center gap-5 pt-2 text-sm">
          <a :href="LANDING_URL" class="hidden text-xs font-semibold tracking-wide sm:inline"
            >BACK TO SITE</a
          >
          <span class="hidden h-6 w-px bg-black/15 sm:inline-block"></span>
          <button
            class="flex items-center gap-2 font-semibold"
            aria-label="Open cart"
            @click="cartOpen = true"
          >
            <span class="relative">
              <i class="fa-solid fa-cart-shopping text-xl"></i>
              <span v-if="cartCount" class="count-dot">{{ cartCount }}</span>
            </span>
            Cart
          </button>
        </div>
      </header>

      <!-- ============ PAGE 1: LIST ============ -->
      <section v-if="route.name === 'list'" class="mx-auto max-w-6xl px-5 pb-20 pt-4">
        <div class="flex flex-wrap items-center justify-between gap-3">
          <label class="search">
            <i class="fa-solid fa-magnifying-glass text-[#5A413A]"></i>
            <input
              v-model="searchQuery"
              type="search"
              placeholder="What are you shopping for?"
              aria-label="Search products"
            />
          </label>

          <label class="filter">
            <select v-model="activeCollection" aria-label="Filter by category">
              <option value="">Filter by category</option>
              <option v-for="c in collections" :key="c.slug" :value="c.slug">{{ c.name }}</option>
            </select>
            <i class="fa-solid fa-chevron-down pointer-events-none text-xs"></i>
          </label>
        </div>

        <!-- Loading -->
        <div
          v-if="loading"
          class="mt-8 grid grid-cols-2 gap-x-5 gap-y-8 md:grid-cols-3 lg:grid-cols-4"
        >
          <div v-for="n in 8" :key="n" class="skeleton">
            <div class="aspect-square rounded-lg bg-[#FFE6D6]"></div>
            <div class="mt-3 h-3 w-3/4 rounded-full bg-[#FFE6D6]"></div>
            <div class="mt-2 h-3 w-1/3 rounded-full bg-[#FFE6D6]"></div>
          </div>
        </div>

        <!-- Error -->
        <div v-else-if="loadError" class="mt-10 rounded-2xl bg-[#FFF7F1] px-6 py-16 text-center">
          <i class="fa-solid fa-triangle-exclamation text-3xl text-[#E2784A]"></i>
          <h3 class="mt-4 font-display text-3xl">We could not load the shop</h3>
          <p class="mt-2 text-[#5A413A]">Check your connection and try again.</p>
          <button class="btn-dark mt-6" @click="loadCatalog()">Try again</button>
        </div>

        <!-- Empty -->
        <div
          v-else-if="!products.length"
          class="mt-10 rounded-2xl bg-[#FFF7F1] px-6 py-16 text-center"
        >
          <i class="fa-solid fa-shirt text-3xl text-[#E2784A]"></i>
          <h3 class="mt-4 font-display text-3xl">No pieces match yet</h3>
          <p class="mx-auto mt-2 max-w-md text-[#5A413A]">
            Try a different search or category. Looking for something specific? We can make it for
            you.
          </p>
          <div class="mt-6 flex flex-wrap justify-center gap-3">
            <button v-if="filtersActive" class="btn-dark" @click="resetFilters">
              Show all pieces
            </button>
            <a :href="`${LANDING_URL}#custom`" class="btn-ghost">Request a custom outfit</a>
          </div>
        </div>

        <!-- Grid -->
        <div v-else class="mt-8 grid grid-cols-2 gap-x-5 gap-y-9 md:grid-cols-3 lg:grid-cols-4">
          <article v-for="p in products" :key="p.id" class="group flex flex-col">
            <a
              :href="`#/product/${encodeURIComponent(p.slug || p.id)}`"
              class="relative block aspect-square overflow-hidden rounded-lg bg-[#FFE6D6]"
            >
              <img
                v-if="p.image"
                :src="p.image"
                :alt="p.name"
                loading="lazy"
                class="h-full w-full object-cover transition duration-500 group-hover:scale-105"
              />
              <span v-else class="flex h-full items-center justify-center text-[#C4623A]/50">
                <i class="fa-solid fa-image text-4xl"></i>
              </span>
              <span
                v-if="!productInStock(p)"
                class="badge absolute left-2 top-2 bg-[#2A1B16] text-white"
                >Sold out</span
              >
              <span
                v-else-if="onSale(p)"
                class="badge absolute left-2 top-2 bg-[#E2784A] text-white"
                >Sale</span
              >
            </a>

            <a
              :href="`#/product/${encodeURIComponent(p.slug || p.id)}`"
              class="mt-3 line-clamp-2 text-sm leading-snug text-[#5A413A] hover:text-[#2A1B16]"
            >
              {{ p.name }}
            </a>

            <div class="mt-2 flex items-center justify-between gap-2">
              <p class="text-xs font-semibold">
                <span v-if="onSale(p)" class="mr-1 font-normal text-[#5A413A] line-through">{{
                  formatKobo(p.compareAt)
                }}</span>
                {{ formatKobo(p.price) }}
              </p>
              <div class="stepper" :class="{ disabled: !productInStock(p) }">
                <button aria-label="Remove one" :disabled="!qtyInCart(p)" @click="cardMinus(p)">
                  −
                </button>
                <span>{{ qtyInCart(p) }}</span>
                <button aria-label="Add one" :disabled="!productInStock(p)" @click="cardPlus(p)">
                  +
                </button>
              </div>
            </div>
          </article>
        </div>

        <div v-if="hasMore && !loading" class="mt-14 flex justify-center">
          <button class="btn-ghost" :disabled="loadingMore" @click="loadCatalog({ append: true })">
            {{ loadingMore ? 'Loading...' : 'Load more pieces' }}
          </button>
        </div>
      </section>

      <!-- ============ PAGE 2: PRODUCT ============ -->
      <section v-else class="mx-auto max-w-6xl px-5 pb-20 pt-4">
        <nav
          class="mb-6 flex items-center gap-2 text-xs uppercase tracking-wide text-[#5A413A]"
          aria-label="Breadcrumb"
        >
          <a href="#" class="hover:text-[#2A1B16]" @click.prevent="goList">Home</a>
          <span>/</span>
          <span class="max-w-[16rem] truncate">{{ selected?.name || 'Product' }}</span>
        </nav>

        <div v-if="loading" class="grid gap-10 md:grid-cols-2">
          <div class="aspect-square rounded-lg bg-[#FFE6D6] skeleton"></div>
          <div class="space-y-4">
            <div class="h-8 w-3/4 rounded-full bg-[#FFE6D6] skeleton"></div>
            <div class="h-6 w-1/4 rounded-full bg-[#FFE6D6] skeleton"></div>
          </div>
        </div>

        <div v-else-if="!selected" class="rounded-2xl bg-[#FFF7F1] px-6 py-16 text-center">
          <h3 class="font-display text-3xl">We could not find that piece</h3>
          <p class="mt-2 text-[#5A413A]">It may have been removed or sold out.</p>
          <button class="btn-dark mt-6" @click="goList">Back to shop</button>
        </div>

        <div v-else class="grid gap-10 md:grid-cols-2">
          <!-- Images -->
          <div>
            <div class="relative">
              <div
                ref="track"
                class="flex aspect-square w-full snap-x snap-mandatory overflow-x-auto rounded-lg bg-[#FFE6D6] [scrollbar-width:none]"
                @scroll.passive="onScroll"
              >
                <div
                  v-for="(m, idx) in selected.images"
                  :key="m.url + idx"
                  class="h-full w-full shrink-0 snap-center"
                >
                  <video
                    v-if="m.type === 'video'"
                    :src="m.url"
                    class="h-full w-full object-cover"
                    controls
                    playsinline
                    preload="metadata"
                  />
                  <img
                    v-else
                    :src="m.url"
                    :alt="selected.name"
                    class="h-full w-full object-cover"
                  />
                </div>
                <div
                  v-if="!selected.images.length"
                  class="flex h-full w-full items-center justify-center text-[#C4623A]/50"
                >
                  <i class="fa-solid fa-image text-5xl"></i>
                </div>
              </div>
              <template v-if="selected.images.length > 1">
                <button
                  class="nav left-2"
                  aria-label="Previous"
                  :disabled="activeImage === 0"
                  @click="slide(-1)"
                >
                  <i class="fa-solid fa-chevron-left text-xs"></i>
                </button>
                <button
                  class="nav right-2"
                  aria-label="Next"
                  :disabled="activeImage === selected.images.length - 1"
                  @click="slide(1)"
                >
                  <i class="fa-solid fa-chevron-right text-xs"></i>
                </button>
              </template>
            </div>
            <div v-if="selected.images.length > 1" class="mt-4 flex gap-3 overflow-x-auto">
              <button
                v-for="(m, idx) in selected.images"
                :key="m.url + idx"
                class="flex h-16 w-16 shrink-0 items-center justify-center overflow-hidden rounded-lg border-2 bg-[#FFE6D6] transition"
                :class="idx === activeImage ? 'border-[#E2784A]' : 'border-transparent opacity-70'"
                @click="goTo(idx)"
              >
                <img
                  v-if="m.type === 'image'"
                  :src="m.url"
                  alt=""
                  class="h-full w-full object-cover"
                />
                <i v-else class="fa-solid fa-play text-[#2A1B16]"></i>
              </button>
            </div>
          </div>

          <!-- Details -->
          <div>
            <h1 class="text-2xl leading-snug md:text-[1.7rem]">{{ selected.name }}</h1>
            <p class="mt-3 flex items-baseline gap-3">
              <span v-if="pageOnSale" class="text-sm text-[#5A413A] line-through">{{
                formatKobo(selected.compareAt)
              }}</span>
              <span class="text-2xl font-semibold">{{ formatKobo(pagePrice) }}</span>
            </p>

            <div class="mt-6">
              <p class="mb-2 text-sm">Quantity:</p>
              <div class="box-stepper">
                <button aria-label="Decrease quantity" @click="pickQty = Math.max(1, pickQty - 1)">
                  −
                </button>
                <span>{{ pickQty }}</span>
                <button
                  aria-label="Increase quantity"
                  @click="pickQty = Math.min(pickQty + 1, maxPickQty)"
                >
                  +
                </button>
              </div>
            </div>

            <div v-if="sizes.length" class="mt-5 max-w-md">
              <p class="mb-2 text-sm">Size:</p>
              <label class="select-box">
                <select v-model="pickSize" aria-label="Size" @change="pageError = ''">
                  <option v-for="s in sizes" :key="s" :value="s">{{ s }}</option>
                </select>
                <i class="fa-solid fa-chevron-down pointer-events-none text-xs"></i>
              </label>
            </div>

            <div v-if="colours.length" class="mt-5 max-w-md">
              <p class="mb-2 text-sm">Colour:</p>
              <label class="select-box">
                <select v-model="pickColour" aria-label="Colour" @change="pageError = ''">
                  <option v-for="c in colours" :key="c" :value="c">{{ c }}</option>
                </select>
                <i class="fa-solid fa-chevron-down pointer-events-none text-xs"></i>
              </label>
            </div>

            <p
              v-if="hasVariants(selected) && matchedVariant && !selected.backorder"
              class="mt-3 text-xs"
              :class="
                pageStock <= 0
                  ? 'text-[#B63C34]'
                  : pageStock <= 3
                    ? 'text-[#C4623A]'
                    : 'text-[#5A413A]'
              "
            >
              {{
                pageStock <= 0 ? 'Sold out' : pageStock <= 3 ? `Only ${pageStock} left` : 'In stock'
              }}
            </p>

            <button
              class="btn-dark mt-6 w-full max-w-md justify-center"
              :disabled="pageSoldOut || !productInStock(selected)"
              @click="addFromPage"
            >
              {{ pageSoldOut || !productInStock(selected) ? 'SOLD OUT' : 'ADD TO CART' }}
            </button>
            <p v-if="pageError" class="mt-3 text-sm text-[#B63C34]">{{ pageError }}</p>

            <div class="mt-8 space-y-4 text-sm leading-relaxed text-[#5A413A]">
              <p v-if="selected.short">{{ selected.short }}</p>
              <p v-if="selected.description" class="whitespace-pre-line">
                {{ selected.description }}
              </p>
              <p v-if="selected.fabric">
                <strong class="text-[#2A1B16]">Fabric:</strong> {{ selected.fabric }}
              </p>
              <p v-if="selected.care">
                <strong class="text-[#2A1B16]">Care:</strong> {{ selected.care }}
              </p>
            </div>

            <div
              v-if="selected.customisable"
              class="mt-6 max-w-md rounded-xl bg-[#FFE6D6] p-4 text-sm"
            >
              Want a different fit? This piece can be made to your measurements.
              <a :href="`${LANDING_URL}#custom`" class="font-semibold underline"
                >Request a custom version</a
              >
            </div>
          </div>
        </div>
      </section>

      <footer class="border-t border-black/10 px-5 py-8 text-xs text-[#5A413A]">
        <div class="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-3">
          <p>© {{ new Date().getFullYear() }} AnniePetars. All rights reserved.</p>
          <div class="flex gap-5">
            <a :href="LANDING_URL" class="hover:text-[#2A1B16]">Main site</a>
            <a :href="`${LANDING_URL}#contact`" class="hover:text-[#2A1B16]">Contact</a>
            <a :href="WHATSAPP" target="_blank" rel="noopener" class="hover:text-[#2A1B16]"
              >WhatsApp</a
            >
          </div>
        </div>
      </footer>

      <!-- TOAST -->
      <transition name="drop">
        <div
          v-if="toast"
          class="fixed bottom-6 left-1/2 z-[2500] flex max-w-[calc(100%-2rem)] -translate-x-1/2 items-center gap-3 rounded-full bg-[#2A1B16] px-5 py-3 text-sm text-[#FFF7F1] shadow-xl"
          role="status"
        >
          <i class="fa-solid fa-circle-check text-[#FFC4A3]"></i>{{ toast }}
        </div>
      </transition>
    </v-main>

    <!-- CART: Vuetify right drawer -->
    <v-navigation-drawer
      v-model="cartOpen"
      location="right"
      temporary
      width="460"
      class="ap cart-drawer"
    >
      <div class="flex h-full flex-col">
        <div class="flex items-center justify-between px-6 py-5 text-xs text-[#5A413A]">
          <ol class="flex items-center gap-2">
            <li class="font-semibold text-[#2A1B16]">Cart</li>
            <li><i class="fa-solid fa-chevron-right text-[9px]"></i></li>
            <li>Information</li>
            <li><i class="fa-solid fa-chevron-right text-[9px]"></i></li>
            <li>Shipping</li>
          </ol>
          <button
            class="p-1 text-lg text-[#2A1B16]"
            aria-label="Close cart"
            @click="cartOpen = false"
          >
            <i class="fa-solid fa-xmark"></i>
          </button>
        </div>

        <div v-if="cart.length" class="flex-1 overflow-y-auto px-6">
          <article
            v-for="i in cart"
            :key="i.key"
            class="flex items-start justify-between gap-4 py-3 text-xs text-[#5A413A]"
          >
            <div class="min-w-0">
              <p class="leading-snug">{{ i.name }}</p>
              <p v-if="i.size || i.colour" class="mt-2">
                {{ [i.size, i.colour].filter(Boolean).join(', ') }}
              </p>
              <p class="mt-2">{{ formatKobo(i.price) }}</p>
              <button class="mt-2 text-[#B63C34] hover:underline" @click="removeItem(i.key)">
                Remove
              </button>
            </div>
            <div class="stepper mt-6 shrink-0">
              <button aria-label="Decrease quantity" @click="changeQty(i.key, -1)">−</button>
              <span>{{ i.qty }}</span>
              <button aria-label="Increase quantity" @click="changeQty(i.key, 1)">+</button>
            </div>
          </article>

          <div class="flex justify-end py-6">
            <button class="flex items-center gap-1 text-xs font-semibold" @click="emptyCart">
              <i class="fa-regular fa-trash-can"></i> Empty Cart
            </button>
          </div>
        </div>

        <div v-else class="flex flex-1 flex-col items-center justify-center px-6 text-center">
          <span
            class="flex h-16 w-16 items-center justify-center rounded-full bg-[#FFC4A3] text-2xl"
          >
            <i class="fa-solid fa-cart-shopping"></i>
          </span>
          <h3 class="mt-5 font-display text-3xl">Your cart is empty</h3>
          <p class="mt-2 text-sm text-[#5A413A]">
            Pick a piece you love and it will wait for you here.
          </p>
          <button class="btn-dark mt-6" @click="cartOpen = false">Continue shopping</button>
        </div>

        <div v-if="cart.length" class="border-t border-black/10 px-6 py-6 text-xs">
          <p class="flex justify-between py-2">
            <span>Items</span><span>{{ formatKobo(cartSubtotal) }}</span>
          </p>
          <p class="flex justify-between py-2">
            <span>Shipping</span><span>{{ formatKobo(shipping) }}</span>
          </p>
          <p class="flex justify-between py-2 font-semibold">
            <span>Total</span><span>{{ formatKobo(cartTotal) }}</span>
          </p>
          <button class="btn-dark mt-4 w-full justify-center" @click="beginCheckout">
            CONTINUE
          </button>
        </div>
      </div>
    </v-navigation-drawer>
  </v-layout>
</template>

<style>
@import url('https://fonts.googleapis.com/css2?family=Fraunces:ital,opsz,wght@0,9..144,300;0,9..144,400;1,9..144,300;1,9..144,400&family=Manrope:wght@400;500;600&display=swap');

/* Vuetify's layout wrapper must not clip or flex the page */
.ap-layout.v-layout {
  display: block;
  overflow: visible;
  min-height: 100vh;
}

.ap {
  font-family: 'Manrope', system-ui, sans-serif;
}
.ap .font-display {
  font-family: 'Fraunces', Georgia, serif;
  font-weight: 300;
}
.ap :focus-visible {
  outline: 2px solid #e2784a;
  outline-offset: 3px;
}
.ap button {
  cursor: pointer;
}
.ap button:disabled {
  cursor: not-allowed;
}

/* Buttons */
.ap .btn-dark,
.ap .btn-ghost {
  display: inline-flex;
  align-items: center;
  border-radius: 8px;
  padding: 0.95rem 1.6rem;
  font-weight: 600;
  font-size: 0.85rem;
  letter-spacing: 0.03em;
  transition:
    background 0.25s,
    color 0.25s,
    transform 0.25s;
}
.ap .btn-dark {
  background: #2a1b16;
  color: #fff7f1;
  box-shadow: 0 6px 16px -8px rgba(42, 27, 22, 0.6);
}
.ap .btn-dark:hover:not(:disabled) {
  background: #e2784a;
}
.ap .btn-dark:disabled {
  opacity: 0.55;
  pointer-events: none;
}
.ap .btn-ghost {
  border: 1.5px solid #2a1b16;
}
.ap .btn-ghost:hover:not(:disabled) {
  background: #2a1b16;
  color: #fff7f1;
}
.ap .btn-ghost:disabled {
  opacity: 0.6;
  pointer-events: none;
}

/* Search + filter (grey pills like the reference) */
.ap .search,
.ap .filter {
  display: flex;
  align-items: center;
  gap: 0.6rem;
  background: #f1f1f1;
  border-radius: 6px;
  padding: 0.7rem 0.9rem;
}
.ap .search {
  width: min(100%, 22rem);
}
.ap .search input {
  background: transparent;
  outline: none;
  width: 100%;
  font-size: 0.8rem;
}
.ap .filter {
  position: relative;
  font-size: 0.8rem;
  font-weight: 600;
}
.ap .filter select {
  appearance: none;
  background: transparent;
  outline: none;
  padding-right: 1.4rem;
  font-weight: 600;
}
.ap .filter i {
  position: absolute;
  right: 0.9rem;
}

/* Steppers */
.ap .stepper {
  display: inline-flex;
  align-items: center;
  gap: 0.5rem;
  font-size: 0.8rem;
}
.ap .stepper button {
  width: 24px;
  height: 24px;
  border-radius: 999px;
  background: #ececec;
  font-size: 0.9rem;
  line-height: 1;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  transition: background 0.2s;
}
.ap .stepper button:hover:not(:disabled) {
  background: #ffc4a3;
}
.ap .stepper button:disabled {
  opacity: 0.5;
}
.ap .stepper span {
  min-width: 1rem;
  text-align: center;
}
.ap .stepper.disabled {
  opacity: 0.5;
}

.ap .box-stepper {
  display: inline-flex;
  align-items: stretch;
  border: 1px solid #e3e3e3;
}
.ap .box-stepper button {
  width: 46px;
  background: #f1f1f1;
  font-size: 1.1rem;
}
.ap .box-stepper button:hover {
  background: #ffe6d6;
}
.ap .box-stepper span {
  min-width: 54px;
  display: flex;
  align-items: center;
  justify-content: center;
}
.ap .box-stepper {
  height: 40px;
}

.ap .select-box {
  position: relative;
  display: flex;
  align-items: center;
  border: 1px solid #e3e3e3;
  border-radius: 4px;
  background: #fff;
}
.ap .select-box select {
  appearance: none;
  width: 100%;
  background: transparent;
  padding: 1rem 2.4rem 1rem 1rem;
  font-size: 0.85rem;
  outline: none;
}
.ap .select-box i {
  position: absolute;
  right: 1rem;
}

.ap .badge {
  border-radius: 999px;
  padding: 0.2rem 0.6rem;
  font-size: 11px;
  font-weight: 600;
}
.ap .count-dot {
  position: absolute;
  top: -8px;
  right: -10px;
  min-width: 18px;
  height: 18px;
  padding: 0 5px;
  border-radius: 999px;
  background: #e2784a;
  color: #fff;
  font-size: 10px;
  font-weight: 600;
  display: flex;
  align-items: center;
  justify-content: center;
}
.ap .skeleton {
  animation: apPulse2 1.4s ease-in-out infinite;
}
@keyframes apPulse2 {
  50% {
    opacity: 0.55;
  }
}
.ap .line-clamp-2 {
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
}

/* Cart drawer (Vuetify) */
.cart-drawer.v-navigation-drawer {
  background: #fff;
  max-width: 100vw;
}

.drop-enter-active,
.drop-leave-active {
  transition: all 0.35s;
}
.drop-enter-from,
.drop-leave-to {
  opacity: 0;
  transform: translate(-50%, 10px);
}

@media (prefers-reduced-motion: reduce) {
  .ap *,
  .ap *::before,
  .ap *::after {
    animation-duration: 0.01ms !important;
    animation-iteration-count: 1 !important;
    transition-duration: 0.01ms !important;
  }
}
.ap .nav {
  position: absolute;
  top: 50%;
  transform: translateY(-50%);
  width: 36px;
  height: 36px;
  border-radius: 999px;
  background: rgba(255, 255, 255, 0.9);
  display: flex;
  align-items: center;
  justify-content: center;
}
.ap .nav:disabled {
  opacity: 0.4;
}
</style>
