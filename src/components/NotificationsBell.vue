<script setup>
import { computed, ref, watch, onBeforeUnmount } from 'vue'
import { useRouter } from 'vue-router'
import { useAuthStore } from '@/stores/auth'
import { supabase } from '@/services/supabase'
import { ElMessage, ElMessageBox, ElNotification } from 'element-plus'

const router = useRouter()
const auth = useAuthStore()
const userId = computed(() => auth.user?.id)
const open = ref(false)
const tab = ref('all')
const rows = ref([])
const counts = ref({ all: 0, unread: 0, read: 0, archived: 0 })
const loading = ref(false)
const busy = ref(false)
const errorText = ref('')
const page = ref(1)
const pageSize = 20
let channel, generation = 0, request = 0
const tabs = [{ value: 'all', title: 'All' }, { value: 'unread', title: 'Unread' }, { value: 'read', title: 'Read' }, { value: 'archived', title: 'Archived' }]
const actions = computed(() => [
  ...(tab.value !== 'read' ? [{ key: 'read', title: 'Mark all as read', icon: 'mdi-check-all' }] : []),
  ...(tab.value !== 'unread' ? [{ key: 'unread', title: 'Mark all as unread', icon: 'mdi-email-outline' }] : []),
  tab.value === 'archived' ? { key: 'restore', title: 'Restore all', icon: 'mdi-archive-arrow-up-outline' } : { key: 'archive', title: 'Archive all', icon: 'mdi-archive-outline' },
  { key: 'delete', title: 'Delete all', icon: 'mdi-delete-outline' }
])
function scope(q, uid, t) {
  q = q.eq('user_id', uid)
  if (t === 'archived') return q.not('archived_at', 'is', null)
  q = q.is('archived_at', null)
  if (t === 'read' || t === 'unread') q = q.eq('is_read', t === 'read')
  return q
}
async function load() {
  const uid = userId.value, t = tab.value, seq = ++request, p = page.value
  if (!uid) return
  loading.value = true
  errorText.value = ''
  try {
    const [list, ...totals] = await Promise.all([
      scope(supabase.from('app_notifications').select('*'), uid, t).order('created_at', { ascending: false }).order('id').range((p - 1) * pageSize, p * pageSize - 1),
      ...tabs.map(x => scope(supabase.from('app_notifications').select('id', { count: 'exact', head: true }), uid, x.value))
    ])
    if (seq !== request || uid !== userId.value) return
    if (list.error) throw list.error
    for (const result of totals) if (result.error) throw result.error
    counts.value = Object.fromEntries(tabs.map((x, i) => [x.value, totals[i].count || 0]))
    if (p > 1 && (p - 1) * pageSize >= counts.value[t]) { page.value = Math.max(1, Math.ceil(counts.value[t] / pageSize)); return }
    rows.value = list.data || []
  } catch (e) { if (seq === request) errorText.value = e.message || 'Unable to load notifications' }
  finally { if (seq === request) loading.value = false }
}
async function mutate(action, item = null) {
  if (busy.value || !userId.value) return false
  const uid = userId.value, t = tab.value
  busy.value = true
  try {
    if (action === 'delete') {
      try { await ElMessageBox.confirm(item ? 'Permanently delete this notification?' : `Permanently delete all ${t === 'all' ? 'active' : t} notifications?`, 'Delete notifications', { type: 'warning', confirmButtonText: 'Delete', cancelButtonText: 'Cancel' }) }
      catch { return false }
    }
    if (uid !== userId.value) return false
    const now = new Date().toISOString()
    const changes = { read: { is_read: true, read_at: now }, unread: { is_read: false, read_at: null }, archive: { archived_at: now }, restore: { archived_at: null } }
    const table = supabase.from('app_notifications')
    let q = action === 'delete' ? table.delete() : table.update(changes[action])
    q = item ? q.eq('user_id', uid).eq('id', item.id) : scope(q, uid, t)
    const { error } = await q
    if (error) throw error
    await load()
    return true
  } catch (e) { ElMessage.error(e.message || 'Notification action failed'); return false }
  finally { busy.value = false }
}
async function visit(n) {
  if (busy.value) return
  if (!n.is_read && !(await mutate('read', n))) return
  if (typeof n.link === 'string' && n.link.startsWith('/admin/') && !n.link.includes('\\')) { open.value = false; await router.push(n.link) }
}
function date(value) { return value ? new Date(value).toLocaleString() : '' }
watch(tab, () => { if (page.value !== 1) page.value = 1; else load() })
watch(page, load)
watch(open, value => { if (value) load() })
watch(userId, async uid => {
  const version = ++generation
  ++request
  const old = channel; channel = null
  rows.value = []; counts.value = { all: 0, unread: 0, read: 0, archived: 0 }; page.value = 1; loading.value = false; errorText.value = ''; open.value = false
  if (old) await supabase.removeChannel(old)
  if (!uid || version !== generation) return
  channel = supabase.channel(`notification-centre-${uid}-${version}`)
    .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'app_notifications', filter: `user_id=eq.${uid}` }, ({ new: n }) => {
      if (version !== generation) return
      ElNotification({ title: n.title, message: n.message, type: 'info' }); load()
    })
    .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'app_notifications', filter: `user_id=eq.${uid}` }, () => { if (version === generation) load() })
    .on('postgres_changes', { event: 'DELETE', schema: 'public', table: 'app_notifications' }, () => { if (version === generation) load() })
    .subscribe(status => { if (status === 'SUBSCRIBED' && version === generation) load() })
  load()
}, { immediate: true })
onBeforeUnmount(() => { generation++; request++; if (channel) supabase.removeChannel(channel) })
</script>

<template>
  <v-menu v-model="open" location="bottom end" :offset="8" :close-on-content-click="false" max-width="calc(100vw - 24px)">
    <template #activator="{ props }">
      <v-btn v-bind="props" icon variant="text" aria-label="Notifications">
        <v-badge :model-value="counts.unread > 0" :content="counts.unread > 99 ? '99+' : counts.unread" color="error">
          <v-icon icon="mdi-bell-outline" size="25" />
        </v-badge>
      </v-btn>
    </template>
    <v-card class="notification-panel" elevation="8" rounded="xl">
      <div class="heading"><div><h3>Notifications</h3><small>{{ counts.unread }} unread notifications</small></div>
        <v-menu location="bottom end">
          <template #activator="{ props }"><v-btn v-bind="props" icon="mdi-dots-horizontal" variant="text" :disabled="busy || !counts[tab]" aria-label="Bulk notification actions" /></template>
          <v-list density="compact"><v-list-item v-for="a in actions" :key="a.key" :prepend-icon="a.icon" :title="a.title" @click="mutate(a.key)" /></v-list>
        </v-menu>
      </div>
      <v-tabs v-model="tab" color="primary" density="compact" grow>
        <v-tab v-for="t in tabs" :key="t.value" :value="t.value" class="tab">{{ t.title }} <span v-if="t.value === 'unread' && counts.unread" class="tab-count">{{ counts.unread }}</span></v-tab>
      </v-tabs>
      <v-progress-linear v-if="loading" indeterminate color="primary" />
      <div class="notification-list">
        <div v-if="errorText" class="empty"><p>{{ errorText }}</p><v-btn variant="text" @click="load">Retry</v-btn></div>
        <div v-else-if="!rows.length && !loading" class="empty"><v-icon icon="mdi-bell-sleep-outline" size="40"/><p>No {{ tab === 'all' ? '' : tab }} notifications</p></div>
        <div v-for="n in errorText ? [] : rows" :key="n.id" class="notice" :class="{ unread: !n.is_read }">
          <button class="notice-body" type="button" :disabled="busy" @click="visit(n)">
            <span class="notice-icon"><v-icon :icon="n.type === 'approval_requested' ? 'mdi-clipboard-clock-outline' : n.type === 'approval_decision' ? 'mdi-clipboard-check-outline' : 'mdi-bell-outline'" /></span>
            <span class="notice-text"><strong>{{ n.title }}</strong><span>{{ n.message }}</span><small>{{ date(n.created_at) }}</small></span>
            <span v-if="!n.is_read" class="dot" />
          </button>
          <v-menu location="bottom end">
            <template #activator="{ props }"><v-btn v-bind="props" icon="mdi-dots-vertical" size="small" variant="text" :disabled="busy" aria-label="Notification actions" /></template>
            <v-list density="compact">
              <v-list-item :title="n.is_read ? 'Mark as unread' : 'Mark as read'" prepend-icon="mdi-email-outline" @click="mutate(n.is_read ? 'unread' : 'read', n)" />
              <v-list-item :title="n.archived_at ? 'Restore' : 'Archive'" prepend-icon="mdi-archive-outline" @click="mutate(n.archived_at ? 'restore' : 'archive', n)" />
              <v-list-item title="Delete" prepend-icon="mdi-delete-outline" @click="mutate('delete', n)" />
            </v-list>
          </v-menu>
        </div>
      </div>
      <div class="footer"><v-btn size="small" variant="text" :disabled="page <= 1 || loading" @click="page--">Previous</v-btn><small>{{ page }} / {{ Math.max(1, Math.ceil(counts[tab] / pageSize)) }}</small><v-btn size="small" variant="text" :disabled="page * pageSize >= counts[tab] || loading" @click="page++">Next</v-btn></div>
    </v-card>
  </v-menu>
</template>
<style scoped>
.notification-panel{width:440px;max-width:calc(100vw - 24px);color:#49352e;background:#fff}.heading,.footer{display:flex;align-items:center;justify-content:space-between;padding:16px}.heading h3{font-size:19px;font-weight:700;margin:0}.heading small,.footer small,.notice small{color:#89766d}.tab{text-transform:none;min-width:0;padding:0 8px;font-size:12px}.tab-count{margin-left:4px;color:#a65332}.notification-list{max-height:min(460px,55vh);overflow:auto;min-height:120px}.notice{display:flex;align-items:flex-start;padding:12px;border-bottom:1px solid #f0e7e1;gap:4px}.notice.unread{background:#fff4ec}.notice-body{display:flex;align-items:flex-start;text-align:left;gap:10px;flex:1;min-width:0}.notice-icon{display:grid;place-items:center;width:38px;height:38px;flex-shrink:0;background:#f8e4d8;color:#a65332;border-radius:12px}.notice-text{display:flex;flex-direction:column;gap:4px;min-width:0;flex:1;overflow-wrap:anywhere;font-size:13px}.notice-text strong{font-size:14px}.dot{width:8px;height:8px;background:#b96a43;border-radius:50%;margin-top:6px;flex-shrink:0}.empty{text-align:center;padding:35px 15px;color:#89766d}.footer{border-top:1px solid #f0e7e1;padding:8px 12px}
</style>
