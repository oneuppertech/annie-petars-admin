<script setup>
import { ref, computed, onMounted, watch } from 'vue'
import { useRoute } from 'vue-router'
import { ElMessage, ElMessageBox } from 'element-plus'
import MainLayout from '@/layouts/MainLayout.vue'
import { inventoryApi, errMsg } from '@/services/inventory'
import { supabase } from '@/services/supabase'
import { present, human, mediaUrl } from './approval'
const names = ref({})
const review = computed(() => (detail.value ? present(detail.value, names.value) : null))
const route = useRoute(),
  rows = ref([]),
  loading = ref(false),
  busy = ref(false),
  status = ref(''),
  q = ref(''),
  detail = ref(null),
  open = ref(false),
  note = ref(''),
  role = ref(''),
  me = ref('')
const reviewer = computed(() => ['owner', 'admin'].includes(role.value))
const statuses = ['pending', 'approved', 'suspended', 'rejected', 'cancelled']
const visible = computed(() =>
  rows.value.filter(
    (r) =>
      (!status.value || r.status === status.value) &&
      `${r.title} ${r.requester_name} ${r.id}`.toLowerCase().includes(q.value.toLowerCase())
  )
)
const colors = {
  pending: 'warning',
  approved: 'success',
  suspended: 'info',
  rejected: 'danger',
  cancelled: 'info'
}
async function load() {
  loading.value = true
  try {
    rows.value = (await inventoryApi.approvals()).requests
  } catch (e) {
    ElMessage.error(errMsg(e))
  } finally {
    loading.value = false
  }
}
async function show(id) {
  try {
    detail.value = (await inventoryApi.approval(id)).request
    note.value = ''
    open.value = true
  } catch (e) {
    ElMessage.error(errMsg(e))
  }
}
async function decide(action) {
  if (!detail.value || busy.value) return
  if (
    ['reject_request', 'suspend_request', 'cancel_request'].includes(action) &&
    !note.value.trim()
  )
    return ElMessage.warning('Enter a reason')
  try {
    await ElMessageBox.confirm('Continue with this decision?', 'Confirm decision', {
      type: 'warning'
    })
  } catch {
    return
  }
  busy.value = true
  try {
    await inventoryApi.act(action, { request_id: detail.value.id, note: note.value })
    ElMessage.success('Request updated')
    await show(detail.value.id)
    await load()
  } catch (e) {
    ElMessage.error(errMsg(e))
  } finally {
    busy.value = false
  }
}
onMounted(async () => {
  const { data } = await supabase.auth.getUser()
  me.value = data.user?.id
  if (me.value) {
    const { data: r } = await supabase
      .from('user_roles')
      .select('role')
      .eq('user_id', me.value)
      .maybeSingle()
    role.value = r?.role
  }
  try {
    const c = await inventoryApi.collections()
    names.value = Object.fromEntries((c.collections || []).map((x) => [x.id, x.name]))
  } catch {}
  await load()
  if (route.query.id) show(route.query.id)
})
watch(
  () => route.query.id,
  (id) => {
    if (id) show(id)
  }
)
</script>
<template>
  <MainLayout
    ><div class="approval-page">
      <header class="flex justify-between items-center mb-6">
        <div>
          <h1>Approval Centre</h1>
          <p>Review and track approval requests.</p>
        </div>
        <el-button @click="load" :loading="loading">Refresh</el-button>
      </header>
      <div class="grid grid-cols-2 md:grid-cols-5 gap-3 mb-6">
        <button
          v-for="s in statuses"
          :key="s"
          class="metric"
          @click="status = status === s ? '' : s"
        >
          <el-tag :type="colors[s]">{{ s }}</el-tag
          ><strong>{{ rows.filter((r) => r.status === s).length }}</strong>
        </button>
      </div>
      <section class="panel">
        <div class="flex flex-wrap gap-3 mb-4">
          <el-input
            v-model="q"
            placeholder="Search requests"
            clearable
            class="max-w-xs"
          /><el-select v-model="status" placeholder="All statuses" clearable class="max-w-xs"
            ><el-option v-for="s in statuses" :key="s" :label="s" :value="s"
          /></el-select>
        </div>
        <el-table :data="visible" v-loading="loading" @row-click="(r) => show(r.id)"
          ><el-table-column label="Request" min-width="240"
            ><template #default="{ row }"
              ><strong>{{ present(row, names).name }}</strong>
              <div class="muted">
                {{ present(row, names).action }} · {{ present(row, names).entity }}
              </div></template
            ></el-table-column
          ><el-table-column prop="requester_name" label="Requester" /><el-table-column
            label="Status"
            ><template #default="{ row }"
              ><el-tag :type="colors[row.status]" round>{{ human(row.status) }}</el-tag></template
            ></el-table-column
          ><el-table-column label="Submitted" min-width="170"
            ><template #default="{ row }">{{
              new Date(row.created_at).toLocaleString()
            }}</template></el-table-column
          ><el-table-column label="Action"
            ><template #default="{ row }"
              ><el-button text @click.stop="show(row.id)">View</el-button></template
            ></el-table-column
          ></el-table
        >
      </section>
    </div>
    <el-dialog
      v-model="open"
      title="Request details"
      width="min(960px, 94vw)"
      append-to-body
      class="approval-dialog"
      :close-on-click-modal="false"
      :show-close="!busy"
      :close-on-press-escape="!busy"
      ><div v-if="detail && review" class="review-content">
        <div class="review-hero">
          <div>
            <small>{{ review.entity }} · {{ review.action }}</small>
            <h2>{{ review.name }}</h2>
            <p>
              Requested by {{ detail.requester_name || 'Staff member' }} ·
              {{ new Date(detail.created_at).toLocaleString() }}
            </p>
          </div>
          <el-tag :type="colors[detail.status]" round>{{ human(detail.status) }}</el-tag>
        </div>
        <el-alert
          v-if="review.warning"
          :title="review.warning"
          type="warning"
          :closable="false"
          show-icon
        />
        <section v-if="review.fields.length" class="review-section">
          <h3>{{ review.action.startsWith('Create') ? 'New details' : 'Details affected' }}</h3>
          <div class="comparison" v-for="f in review.fields" :key="f.label">
            <strong>{{ f.label }}</strong>
            <div v-if="!review.action.startsWith('Create')" class="before">
              <small>Before request</small>{{ f.before }}
            </div>
            <div v-if="!review.action.startsWith('Delete')" class="after">
              <small>Proposed</small>{{ f.after }}
            </div>
          </div>
        </section>
        <section v-if="review.items.length" class="review-section">
          <h3>Items affected ({{ review.items.length }})</h3>
          <article v-for="(item, i) in review.items" :key="i" class="item-card">
            <div class="item-head">
              <strong>{{ item.name }}</strong
              ><el-tag
                :type="
                  item.kind === 'Added' ? 'success' : item.kind === 'Changed' ? 'warning' : 'danger'
                "
                >{{ item.kind }}</el-tag
              >
            </div>
            <div v-for="f in item.diff" :key="f.label" class="comparison">
              <strong>{{ f.label }}</strong>
              <div v-if="item.kind !== 'Added'" class="before">
                <small>Before request</small>{{ f.before }}
              </div>
              <div v-if="!['Removed', 'Deactivated'].includes(item.kind)" class="after">
                <small>Proposed</small>{{ f.after }}
              </div>
            </div>
          </article>
        </section>
        <section v-if="review.media.length" class="review-section">
          <h3>Images &amp; videos</h3>
          <div class="media-grid">
            <article v-for="(m, i) in review.media" :key="i" class="item-card">
              <div class="item-head">
                <strong>Media {{ i + 1 }}</strong
                ><el-tag
                  :type="
                    m.kind === 'Added'
                      ? 'success'
                      : m.kind === 'Removed'
                        ? 'danger'
                        : m.kind === 'Changed'
                          ? 'warning'
                          : 'info'
                  "
                  >{{ m.kind }}</el-tag
                >
              </div>
              <div class="media-pair">
                <div
                  v-for="(asset, j) in m.kind === 'Changed'
                    ? [m.before, m.after]
                    : [m.after || m.before]"
                  :key="j"
                >
                  <small v-if="m.kind === 'Changed'">{{
                    j === 0 ? 'Before request' : 'Proposed'
                  }}</small
                  ><template v-if="mediaUrl(asset)"
                    ><video
                      v-if="
                        asset.media_type === 'video' ||
                        /\.(mp4|webm|mov)(?:[?#]|$)/i.test(asset.image_url)
                      "
                      :src="mediaUrl(asset)"
                      controls
                      preload="metadata"
                      playsinline
                    /><el-image
                      v-else
                      :src="mediaUrl(asset)"
                      fit="contain"
                      :preview-src-list="[mediaUrl(asset)]"
                      preview-teleported
                      ><template #error
                        ><div class="media-error">Image unavailable</div></template
                      ></el-image
                    ><a :href="mediaUrl(asset)" target="_blank" rel="noopener noreferrer"
                      >Open media</a
                    ></template
                  >
                  <p v-else>Media unavailable</p>
                  <p v-if="asset.is_primary" class="muted">Primary media</p>
                  <p v-if="asset.alt_text">{{ asset.alt_text }}</p>
                </div>
              </div>
              <p v-for="f in m.diff || []" :key="f.label" class="muted">
                {{ f.label }}: {{ f.before }} → {{ f.after }}
              </p>
            </article>
          </div>
        </section>
        <p
          v-if="
            !review.fields.length &&
            !review.items.length &&
            !review.media.some((m) => m.kind !== 'Unchanged')
          "
          class="muted"
        >
          No visible changes detected in the supplied request details.
        </p>
        <el-alert
          v-if="detail.review_note"
          :title="'Review note: ' + detail.review_note"
          type="info"
          :closable="false"
        />
        <h3 class="my-4">Activity history</h3>
        <el-timeline
          ><el-timeline-item
            v-for="h in [...(detail.inventory_approval_history || [])].sort((a, b) =>
              a.created_at.localeCompare(b.created_at)
            )"
            :key="h.id"
            :timestamp="new Date(h.created_at).toLocaleString()"
            >{{ human(h.action) }} · {{ human(h.new_status) }}
            <p>{{ h.note }}</p></el-timeline-item
          ></el-timeline
        ><el-input
          v-if="['pending', 'suspended'].includes(detail.status)"
          v-model="note"
          type="textarea"
          placeholder="Decision reason or comment"
          :rows="3"
        />
      </div>
      <template #footer
        ><div
          v-if="detail && ['pending', 'suspended'].includes(detail.status)"
          class="flex flex-wrap justify-end gap-2"
        >
          <template v-if="reviewer && detail.requested_by !== me"
            ><el-button
              v-if="detail.status === 'pending'"
              type="success"
              :disabled="busy"
              @click="decide('approve_request')"
              >Approve</el-button
            ><el-button
              v-if="detail.status === 'pending'"
              :disabled="busy"
              @click="decide('suspend_request')"
              >Suspend</el-button
            ><el-button v-else :disabled="busy" @click="decide('resume_request')">Resume</el-button
            ><el-button type="danger" :disabled="busy" @click="decide('reject_request')"
              >Reject</el-button
            ></template
          ><el-button
            v-if="detail.requested_by === me"
            :disabled="busy"
            @click="decide('cancel_request')"
            >Withdraw</el-button
          >
        </div></template
      ></el-dialog
    ></MainLayout
  >
</template>
<style scoped>
.approval-page {
  padding: 24px;
  color: #49352e;
}
.approval-page h1 {
  font-size: 28px;
  font-weight: 700;
}
.approval-page small {
  color: #a77d6c;
  letter-spacing: 0.08em;
}
.metric,
.panel {
  background: white;
  border: 1px solid #efdfd5;
  border-radius: 16px;
  padding: 18px;
  text-align: left;
}
.metric strong {
  display: block;
  font-size: 28px;
  margin-top: 10px;
}
pre {
  background: #faf5f1;
  border-radius: 12px;
  padding: 14px;
  max-height: 300px;
  overflow: auto;
  font-size: 12px;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
}
.review-hero {
  display: flex;
  justify-content: space-between;
  gap: 16px;
  align-items: start;
  padding: 20px;
  background: #fff5ee;
  border-radius: 16px;
  margin-bottom: 18px;
}
.review-hero h2 {
  font-size: 25px;
  font-weight: 700;
  color: #49352e;
}
.review-hero p,
.muted {
  color: #806b61;
  font-size: 12px;
}
.review-section {
  margin: 22px 0;
}
.review-section h3 {
  font-size: 17px;
  font-weight: 700;
  margin-bottom: 12px;
}
.comparison {
  display: grid;
  grid-template-columns: minmax(100px, 1fr) 2fr 2fr;
  gap: 10px;
  align-items: start;
  padding: 10px 0;
  border-bottom: 1px solid #eee5df;
  overflow-wrap: anywhere;
}
.comparison small,
.media-pair small {
  display: block;
  font-size: 11px;
  margin-bottom: 4px;
}
.before,
.after {
  padding: 10px;
  border-radius: 8px;
  white-space: pre-wrap;
}
.before {
  background: #fff2ef;
  color: #87463b;
}
.after {
  background: #edf8ef;
  color: #24603c;
}
.item-card {
  border: 1px solid #eaded6;
  border-radius: 12px;
  padding: 14px;
  margin-bottom: 10px;
}
.item-head {
  display: flex;
  justify-content: space-between;
  gap: 8px;
  margin-bottom: 10px;
}
.media-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
  gap: 12px;
}
.media-pair {
  display: flex;
  gap: 8px;
}
.media-pair > div {
  flex: 1;
  min-width: 0;
}
.media-pair video,
.media-pair :deep(.el-image) {
  width: 100%;
  height: 180px;
  background: #f7f2ee;
  border-radius: 8px;
  object-fit: contain;
}
.media-pair a {
  display: block;
  color: #a54d2c;
  font-size: 12px;
  margin-top: 6px;
}
.media-error {
  padding: 20px;
  text-align: center;
}
@media (max-width: 600px) {
  .comparison {
    grid-template-columns: 1fr 1fr;
  }
  .comparison > strong {
    grid-column: 1/-1;
  }
  .review-hero {
    flex-direction: column;
  }
}
</style>
<style>
.approval-dialog.el-dialog {
  border-radius: 20px;
  padding: 24px;
}
.approval-dialog .el-dialog__body {
  max-height: 65vh;
  overflow: auto;
}
</style>
