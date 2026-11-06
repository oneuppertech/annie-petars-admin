<template>
  <!-- NAVBAR -->
  <header class="fixed top-7 inset-x-0 z-50 bg-white/90 backdrop-blur shadow-lg py-2">
    <div
      class="absolute bottom-0 left-0 h-0.5 bg-[#A8E80F]"
      :style="{ width: progress + '%' }"
    ></div>
    <div class="max-w-7xl mx-auto px-5 flex items-center justify-between">
      <RouterLink to="/">
        <img :src="images.logo" alt="Paratus Dwellings" class="h-12 w-auto" @error="hideBroken" />
      </RouterLink>
      <nav class="hidden lg:flex items-center gap-7" aria-label="Main">
        <template v-for="l in links" :key="l.href">
          <a
            v-if="l.external"
            :href="l.href"
            target="_blank"
            rel="noopener noreferrer"
            class="relative text-sm font-semibold text-[#0A2A5C] after:absolute after:-bottom-1 after:left-0 after:h-0.5 after:w-0 after:bg-[#A8E80F] after:transition-all hover:after:w-full"
          >
            {{ l.label }}
          </a>
          <RouterLink
            v-else
            :to="l.href"
            class="relative text-sm font-semibold text-[#0A2A5C] after:absolute after:-bottom-1 after:left-0 after:h-0.5 after:w-0 after:bg-[#A8E80F] after:transition-all hover:after:w-full"
            active-class="!text-[#15803d] after:!w-full"
            exact-active-class="!text-[#15803d] after:!w-full"
          >
            {{ l.label }}
          </RouterLink>
        </template>
      </nav>
      <button
        class="lg:hidden text-2xl text-[#0A2A5C]"
        @click="menuOpen = !menuOpen"
        aria-label="Menu"
      >
        <i :class="menuOpen ? 'fa-solid fa-xmark' : 'fa-solid fa-bars'"></i>
      </button>
    </div>
    <Transition name="drop">
      <div v-if="menuOpen" class="lg:hidden bg-white shadow-xl mt-2 mx-4 rounded-2xl p-5 space-y-3">
        <template v-for="l in links" :key="l.href">
          <a
            v-if="l.external"
            :href="l.href"
            target="_blank"
            rel="noopener noreferrer"
            class="block font-semibold text-[#0A2A5C] py-1"
            @click="menuOpen = false"
          >
            {{ l.label }}
          </a>

          <RouterLink
            v-else
            :to="l.href"
            class="block font-semibold text-[#0A2A5C] py-1"
            active-class="!text-[#15803d]"
            exact-active-class="!text-[#15803d]"
            @click="menuOpen = false"
          >
            {{ l.label }}
          </RouterLink>
        </template>

        <a
          :href="TEL"
          class="block text-center px-5 py-3 rounded-full bg-[#A8E80F] text-[#0A2A5C] font-bold"
        >
          Call {{ PHONE }}
        </a>
      </div>
    </Transition>
  </header>
</template>

<script setup>
import { ref, computed, onMounted, onBeforeUnmount } from 'vue'

/* ---------- ASSETS (same filenames as before; missing images hide themselves) ---------- */
const asset = (name) => new URL(`../assets/${name}`, import.meta.url).href
const images = {
  logo: asset('paratus-dwellings-logo.png'),
  hero: asset('hero.jpg'),
  about: asset('about.jpg'),
  cleaning: asset('cleaning.jpg'),
  training: asset('training.jpg'),
  p1: asset('project-1.jpg'),
  p2: asset('project-2.jpg'),
  p3: asset('project-3.jpg'),
  p4: asset('project-4.jpg'),
  p5: asset('project-5.jpg'),
  p6: asset('project-6.jpg')
}
const hideBroken = (e) => (e.target.style.display = 'none')
const PHONE = '07350 154705'
const TEL = 'tel:07350154705'
const EMAIL = 'info@paratusdwellings.co.uk'

/* shared class strings */
const eyebrow = 'text-sm font-bold tracking-widest uppercase text-[#8fcf0a]'
const h2 = 'mt-3 text-3xl lg:text-4xl font-extrabold text-[#0A2A5C] leading-tight'
const input =
  'w-full rounded-xl border border-slate-200 px-4 py-3 focus:outline-none focus:ring-2 focus:ring-[#A8E80F]'

/* ---------- NAV / UI STATE ---------- */
const scrolled = ref(false)
const progress = ref(0)
const menuOpen = ref(false)
const cookies = ref(true)
const onScroll = () => {
  scrolled.value = window.scrollY > 40
  const h = document.documentElement.scrollHeight - window.innerHeight
  progress.value = h > 0 ? (window.scrollY / h) * 100 : 0
}
const links = [
  { label: 'Home', href: '/', external: false },
  { label: 'About', href: '/about', external: false },
  { label: 'Services', href: '/services', external: false },
  { label: 'Support', href: '/support', external: false },
  { label: 'Safeguarding', href: '/safeguarding', external: false },
  {
    label: 'Cleaning Agency',
    href: 'https://www.cleaning.paratusdwellings.co.uk/',
    external: true
  },
  { label: 'Skills', href: '/skills', external: false }
]
/* ---------- DATA ---------- */
const stats = [
  { value: 18, suffix: '+', label: 'Adults Supported' },
  { value: 3, suffix: '+', label: 'Years Leadership Experience' },
  { value: 2, suffix: '', label: 'Support Windows: Day & Evening' },
  { value: 5, suffix: '', label: 'Step Individual Journey' }
]
const counts = ref(stats.map(() => 0))
const statsEl = ref(null)
let statsObserver = null
let counted = false
const runCounters = () => {
  if (counted) return
  counted = true
  const start = performance.now()
  const tick = (now) => {
    const p = Math.min((now - start) / 1600, 1)
    const e = 1 - Math.pow(1 - p, 3)
    counts.value = stats.map((s) => Math.round(s.value * e))
    if (p < 1) requestAnimationFrame(tick)
  }
  requestAnimationFrame(tick)
}

const reasons = [
  {
    icon: 'fa-solid fa-shield-heart',
    title: 'Safe Homes',
    text: 'Safeguarding-led, health and safety-checked, and compliant with local housing requirements.'
  },
  {
    icon: 'fa-solid fa-hands-holding-circle',
    title: 'Skilled People',
    text: 'Life skills, digital skills and employability support for confident independence.'
  },
  {
    icon: 'fa-solid fa-sun',
    title: 'Brighter Futures',
    text: 'Person-centred plans that turn goals into real next steps.'
  }
]

const services = [
  {
    icon: 'fa-solid fa-house-chimney-user',
    title: 'Supported Accommodation',
    text: 'A stable, safe and welcoming place to live for adults aged 18+ working towards independence.'
  },
  {
    icon: 'fa-solid fa-sun-bright',
    title: 'Day & Evening Support',
    text: 'Structured daytime support and a settled, supervised evening environment.'
  },
  {
    icon: 'fa-solid fa-person-walking-arrow-right',
    title: 'Independent Living Skills',
    text: 'Budgeting, cooking, shopping, time management and household routines.'
  },
  {
    icon: 'fa-solid fa-broom',
    title: 'Housekeeping & Cleaning',
    text: 'Clean, hygienic homes and shared spaces, plus practical cleaning skills for residents.'
  },
  {
    icon: 'fa-solid fa-briefcase',
    title: 'Employability Support',
    text: 'CVs, job searching, applications, interview practice and workplace readiness.'
  },
  {
    icon: 'fa-solid fa-laptop',
    title: 'Digital Skills',
    text: 'Everyday digital confidence, with certification pathways where approved providers are available.'
  },
  {
    icon: 'fa-solid fa-user-shield',
    title: 'Safeguarding',
    text: 'Clear procedures to protect adults, record concerns and escalate them appropriately.'
  },
  {
    icon: 'fa-solid fa-helmet-safety',
    title: 'Health & Safety',
    text: 'Risk assessments, fire safety and regular property and activity checks.'
  },
  {
    icon: 'fa-solid fa-clipboard-check',
    title: 'Housing Compliance',
    text: 'Working to meet local housing, licensing and landlord safety requirements.'
  }
]

const tab = ref('day')
const support = {
  day: {
    icon: 'fa-solid fa-sun',
    title: 'Day Support',
    items: [
      'Individual development planning and key-work sessions',
      'Budgeting, cooking and household routine coaching',
      'CV writing, job searching and interview practice',
      'Digital skills sessions and online applications',
      'Help attending appointments, education and training',
      'Tenancy, housing and property-related guidance'
    ]
  },
  evening: {
    icon: 'fa-solid fa-moon',
    title: 'Evening Support',
    items: [
      'A calm, safe and welcoming evening environment',
      'Support with meal routines, shared living and wind-down',
      'Prompt response to concerns, incidents and house issues',
      'Guided activities, social groups and peer connection',
      'Check-ins and awareness of well-being changes',
      'Escalation of safeguarding concerns through proper channels'
    ]
  }
}

const safeguarding = [
  {
    icon: 'fa-solid fa-user-lock',
    t: 'Designated Safeguarding Lead',
    d: 'A named lead who receives, records and acts on concerns.'
  },
  {
    icon: 'fa-solid fa-id-card-clip',
    t: 'Safer Recruitment',
    d: 'Robust recruitment checks, including DBS, references and induction.'
  },
  {
    icon: 'fa-solid fa-graduation-cap',
    t: 'Regular Training',
    d: 'Staff trained to spot abuse, neglect, exploitation and online harm.'
  },
  {
    icon: 'fa-solid fa-triangle-exclamation',
    t: 'Clear Escalation',
    d: 'Concerns are recorded and referred to the local authority safeguarding team.'
  },
  {
    icon: 'fa-solid fa-person-circle-question',
    t: 'Missing Person Protocol',
    d: 'A defined response when a resident is unexpectedly absent.'
  },
  {
    icon: 'fa-solid fa-scale-balanced',
    t: 'Boundaries & Dignity',
    d: 'Professional boundaries, equality and respect in every interaction.'
  },
  {
    icon: 'fa-solid fa-lock',
    t: 'Confidentiality',
    d: 'Personal information is protected and shared only when necessary.'
  },
  {
    icon: 'fa-solid fa-bullhorn',
    t: 'Feedback & Whistleblowing',
    d: 'Clear complaints and whistleblowing routes for residents and staff.'
  }
]

const ctab = ref('hs')
const compliance = {
  hs: {
    label: 'Health & Safety',
    icon: 'fa-solid fa-helmet-safety',
    items: [
      'Risk assessments for properties, residents and planned activities',
      'Fire risk assessment, working alarms, clear escape routes and regular fire drills',
      'Accident and incident recording with managed follow-up actions',
      'First aid awareness and emergency procedures',
      'Safe kitchen practice and food hygiene awareness',
      'Lone working and staff safety arrangements',
      'Scheduled property inspections and prompt repairs reporting'
    ]
  },
  housing: {
    label: 'Local Housing Compliance',
    icon: 'fa-solid fa-clipboard-check',
    items: [
      'Annual gas safety checks and valid certification',
      'Electrical installation condition checks within required timescales',
      'Smoke and carbon monoxide alarms, tested regularly',
      'Legionella risk awareness and water-safety checks',
      'HMO and supported-housing licensing, where applicable',
      'Properties kept free from hazards under the Housing Health and Safety Rating System',
      'Clear licence or tenancy agreements and Right to Rent checks',
      'Working with local authority housing and environmental health teams'
    ]
  },
  clean: {
    label: 'Cleaning & Hygiene',
    icon: 'fa-solid fa-spray-can-sparkles',
    items: [
      'Planned cleaning schedules for communal areas',
      'Deep cleans between residents and end-of-tenancy cleaning',
      'COSHH-aware cleaning products and safe storage',
      'Pest, damp and mould awareness with fast reporting',
      'Waste and recycling routines',
      'Resident housekeeping coaching and shared-space standards'
    ]
  }
}

const cleaning = [
  { icon: 'fa-solid fa-house-circle-check', t: 'Home & Communal Cleaning' },
  { icon: 'fa-solid fa-key', t: 'End-of-Tenancy Cleaning' },
  { icon: 'fa-solid fa-sparkles', t: 'Deep Cleans & Refresh' },
  { icon: 'fa-solid fa-hand-sparkles', t: 'Resident Housekeeping Skills' }
]

const steps = [
  {
    n: '01',
    title: 'Initial Assessment',
    text: 'We discuss circumstances, strengths, risks and support needs.'
  },
  {
    n: '02',
    title: 'Development Plan',
    text: 'Agree practical goals for living, learning and work.'
  },
  {
    n: '03',
    title: 'Skills Development',
    text: 'Structured life, digital and employability sessions.'
  },
  {
    n: '04',
    title: 'Education & Work',
    text: 'Support into training, job searches and interviews.'
  },
  { n: '05', title: 'Progress & Independence', text: 'Review achievements and plan the next step.' }
]

const filters = ['All', 'Accommodation', 'Learning', 'Community', 'Cleaning']
const activeFilter = ref('All')
const gallery = [
  { title: 'Shared Living Space', cat: 'Accommodation', img: images.p1 },
  { title: 'Private Bedroom', cat: 'Accommodation', img: images.p2 },
  { title: 'Cooking Session', cat: 'Learning', img: images.p3 },
  { title: 'Digital Skills Class', cat: 'Learning', img: images.training },
  { title: 'Community Outing', cat: 'Community', img: images.p4 },
  { title: 'Group Activity', cat: 'Community', img: images.p5 },
  { title: 'Communal Area Clean', cat: 'Cleaning', img: images.cleaning },
  { title: 'Welcoming Entrance', cat: 'Accommodation', img: images.p6 }
]
const visibleGallery = computed(() =>
  activeFilter.value === 'All' ? gallery : gallery.filter((p) => p.cat === activeFilter.value)
)

const skills = [
  'Budgeting & Money Management',
  'Cooking & Meal Planning',
  'Digital Skills & Online Safety',
  'CV, Applications & Interviews',
  'Time & Household Management',
  'Communication & Confidence'
]

const supportGroups = [
  'Care leavers preparing for independent living',
  'Adults transitioning into independent living',
  'Adults seeking education, training or work',
  'Adults facing housing instability'
]

const faqs = [
  {
    q: 'Who is your accommodation for?',
    a: 'Adults aged 18 and over who need a safe home and practical support to build independent living skills, including care leavers and those at risk of housing instability. Every placement is subject to assessment, suitability and availability.'
  },
  {
    q: 'What are your support hours?',
    a: 'We provide day and evening support. Exact hours depend on the placement and the service agreed with the referrer. Contact us to discuss.'
  },
  {
    q: 'How do you keep residents safe?',
    a: 'Through safeguarding procedures, trained staff, risk assessments, fire and property safety checks, and clear routes for raising concerns.'
  },
  {
    q: 'Do you provide personal care or nursing?',
    a: 'No. We do not provide personal care, nursing or clinical treatment. Our focus is accommodation, practical independence skills and employability.'
  },
  {
    q: 'Do you offer cleaning services?',
    a: 'Cleaning is part of how we keep homes safe and hygienic, including communal and end-of-tenancy cleaning, and we teach practical housekeeping skills. Ask us about wider cleaning enquiries.'
  },
  {
    q: 'Who can make a referral?',
    a: 'Local authorities, leaving-care teams, social workers, housing teams, personal advisers, education and employment providers, and adults or their representatives.'
  },
  {
    q: 'Is accommodation guaranteed after a referral?',
    a: 'No. Placements depend on assessment, suitability and availability.'
  },
  {
    q: 'Do you guarantee certificates or jobs?',
    a: 'No. We support residents towards relevant certificates and employment, but outcomes depend on provider arrangements, eligibility and individual progress.'
  }
]
const openFaq = ref(0)

const categories = [
  'Supported accommodation',
  'Referral enquiry',
  'Independent living support',
  'Employability and training',
  'Digital skills',
  'Cleaning enquiry',
  'Partnership',
  'General enquiry'
]
const blank = () => ({
  name: '',
  org: '',
  email: '',
  phone: '',
  category: '',
  contact: 'Email',
  message: '',
  consent: false,
  website: ''
})
const form = ref(blank())
const sent = ref(false)
const submit = () => {
  if (form.value.website) return // honeypot spam trap
  // TODO: connect to your backend / secure email service
  sent.value = true
  setTimeout(() => (sent.value = false), 5000)
  form.value = blank()
}

onMounted(() => {
  window.addEventListener('scroll', onScroll, { passive: true })
  onScroll()
  statsObserver = new IntersectionObserver((e) => e[0].isIntersecting && runCounters(), {
    threshold: 0.4
  })
  if (statsEl.value) statsObserver.observe(statsEl.value)
})
onBeforeUnmount(() => {
  window.removeEventListener('scroll', onScroll)
  statsObserver && statsObserver.disconnect()
})
</script>
