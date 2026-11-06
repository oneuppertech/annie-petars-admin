<script setup>
import { computed } from 'vue'
import { useRouter } from 'vue-router'
import { useAuthStore } from '@/stores/auth'

const router = useRouter()
const auth = useAuthStore()

const partner = computed(() => auth.partner ?? {})

const displayName = computed(
  () => partner.value.contact_name || partner.value.business_name || partner.value.email?.split('@')[0] || 'Partner',
)
const email = computed(() => partner.value.email || '')
const businessName = computed(() => partner.value.business_name || '')

const initials = computed(() => {
  const parts = displayName.value.trim().split(/\s+/)
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase()
  return `${parts[0][0]}${parts[parts.length - 1][0]}`.toUpperCase()
})

// partners.kyc_status -> label + pill colours
const KYC = {
  not_started: { label: 'Verification needed', bg: '#fff3e0', color: '#b45309' },
  submitted: { label: 'KYC submitted', bg: '#eaf2ff', color: '#2b7fff' },
  under_review: { label: 'Under review', bg: '#eaf2ff', color: '#2b7fff' },
  resubmission_required: { label: 'Resubmit documents', bg: '#fff3e0', color: '#b45309' },
  approved: { label: 'Verified', bg: '#e8f5e9', color: '#1b8a3a' },
  rejected: { label: 'KYC rejected', bg: '#fee2e2', color: '#b91c1c' },
  suspended: { label: 'Suspended', bg: '#fee2e2', color: '#b91c1c' },
}
const kyc = computed(() => KYC[partner.value.kyc_status] ?? KYC.not_started)

async function handleLogout() {
  try {
    await auth.logout()
  } finally {
    router.push({ name: 'login' })
  }
}
</script>

<template>
  <div class="flex w-full items-center justify-end gap-4">
    <v-menu location="bottom end" :offset="8">
      <template #activator="{ props }">
        <button v-bind="props" class="flex items-center gap-2 rounded-xl bg-white px-2 py-1.5 transition hover:bg-gray-50">
          <div class="avatar avatar--sm">{{ initials }}</div>

          <div class="hidden min-w-0 text-left md:block">
            <p class="max-w-[150px] truncate text-xs font-semibold text-gray-800">{{ displayName }}</p>
            <p class="max-w-[150px] truncate text-[10px] text-gray-400">{{ email }}</p>
          </div>

          <i class="mdi mdi-chevron-down hidden text-sm text-gray-400 md:block"></i>
        </button>
      </template>

      <v-card min-width="280" class="overflow-hidden rounded-2xl border border-gray-100" elevation="8">
        <div class="border-b border-gray-100 px-4 py-4">
          <div class="flex items-center gap-3">
            <div class="avatar avatar--lg">{{ initials }}</div>
            <div class="min-w-0">
              <p class="truncate text-sm font-semibold text-gray-900">{{ displayName }}</p>
              <p class="mt-0.5 truncate text-xs text-gray-400">{{ email }}</p>
              <p v-if="businessName" class="mt-0.5 truncate text-xs text-gray-500">{{ businessName }}</p>
            </div>
          </div>
          <span class="kyc-pill mt-3" :style="{ background: kyc.bg, color: kyc.color }">{{ kyc.label }}</span>
        </div>

        <div class="p-2">
          <v-list class="pa-0" density="comfortable">
            <!-- <v-list-item to="/kyc" rounded="lg">
              <template #prepend><i class="mdi mdi-shield-check-outline mr-3 text-base text-gray-400"></i></template>
              <v-list-item-title class="text-sm">Business verification</v-list-item-title>
            </v-list-item>

            <v-list-item to="/settings" rounded="lg">
              <template #prepend><i class="mdi mdi-cog-outline mr-3 text-base text-gray-400"></i></template>
              <v-list-item-title class="text-sm">Settings</v-list-item-title>
            </v-list-item> -->

            <v-divider class="my-2" />

            <v-list-item rounded="lg" class="logout-item" @click="handleLogout">
              <template #prepend><i class="mdi mdi-logout mr-3 text-base"></i></template>
              <v-list-item-title class="text-sm font-medium">Logout</v-list-item-title>
            </v-list-item>
          </v-list>
        </div>
      </v-card>
    </v-menu>
  </div>
</template>

<style scoped>
.avatar { display: flex; align-items: center; justify-content: center; flex-shrink: 0; color: #fff; font-weight: 700; background: linear-gradient(135deg, #2b7fff, #1d5fd1); }
.avatar--sm { width: 36px; height: 36px; border-radius: 12px; font-size: 11px; }
.avatar--lg { width: 48px; height: 48px; border-radius: 12px; font-size: 14px; }
.kyc-pill { display: inline-block; font-size: 10px; font-weight: 600; padding: 3px 10px; border-radius: 999px; }
.logout-item { color: #dc2626; }
.logout-item:hover { background: #fef2f2; }
</style>