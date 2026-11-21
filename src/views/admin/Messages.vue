
<template>
  <MainLayout>
    <div class="messages-page">
      <!-- Page header -->
      <div class="page-header">
        <div>
          <p class="eyebrow">CUSTOMER SUPPORT</p>
          <h1>Messages</h1>
          <p class="subtitle">
            Manage customer enquiries and continue conversations.
          </p>
        </div>

        <div class="header-actions">
          <div class="unread-summary">
            <span class="unread-dot"></span>
            <strong>{{ unreadCount }}</strong>
            <span>unread</span>
          </div>

          <el-button :loading="loading" @click="loadMessages">
            Refresh
          </el-button>
        </div>
      </div>

      <!-- Statistics -->
      <div class="stats-grid">
        <div class="stat-card">
          <span class="stat-label">Total messages</span>
          <strong>{{ meta.total || 0 }}</strong>
        </div>

        <div class="stat-card">
          <span class="stat-label">Unread</span>
          <strong class="stat-unread">{{ unreadCount }}</strong>
        </div>

        <div class="stat-card">
          <span class="stat-label">Current page</span>
          <strong>{{ meta.page || 1 }} / {{ meta.pages || 1 }}</strong>
        </div>
      </div>

      <!-- Filters -->
      <div class="inbox-toolbar">
        <el-input
          v-model="search"
          clearable
          placeholder="Search name, email or enquiry..."
          class="search-input"
        />

        <el-select
          v-model="statusFilter"
          placeholder="Filter by status"
          class="status-filter"
        >
          <el-option label="All messages" value="all" />
          <el-option label="New" value="new" />
          <el-option label="In progress" value="in_progress" />
          <el-option label="Resolved" value="resolved" />
          <el-option label="Spam" value="spam" />
        </el-select>
      </div>

      <!-- Inbox -->
      <div class="inbox-card">
        <div class="inbox-heading">
          <div>
            <h2>Customer enquiries</h2>
            <p>Open an enquiry to view and respond to the conversation.</p>
          </div>

          <span class="result-count">
            {{ messages.length }} results
          </span>
        </div>

        <div v-if="loading && !messages.length" class="loading-state">
          <el-skeleton :rows="5" animated />
        </div>

        <div v-else-if="errorMessage && !messages.length" class="empty-state">
          <p>{{ errorMessage }}</p>
          <el-button @click="loadMessages">Try again</el-button>
        </div>

        <div v-else-if="!messages.length" class="empty-state">
          <div class="empty-icon">✉</div>
          <h3>No messages found</h3>
          <p>Customer enquiries will appear here when submitted.</p>
        </div>

        <div v-else class="message-list">
          <button
            v-for="item in messages"
            :key="item.id"
            type="button"
            class="message-row"
            :class="{ 'message-unread': isUnread(item) }"
            @click="openConversation(item)"
          >
            <div class="message-avatar">
              {{ initials(item.name) }}
              <span v-if="isUnread(item)" class="avatar-unread"></span>
            </div>

            <div class="message-content">
              <div class="message-topline">
                <strong class="customer-name">
                  {{ item.name || 'Unknown customer' }}
                </strong>

                <span class="message-date">
                  {{ formatRelativeDate(item.last_message_at || item.created_at) }}
                </span>
              </div>

              <div class="message-middle">
                <span class="customer-email">{{ item.email }}</span>

                <el-tag
                  size="small"
                  effect="light"
                  :type="statusTagType(item.status)"
                >
                  {{ statusLabel(item.status) }}
                </el-tag>
              </div>

              <div class="message-bottomline">
                <span class="enquiry-type">
                  {{ item.enquiry_type || 'General enquiry' }}
                </span>

                <span class="message-preview">
                  {{ item.last_message_preview || item.message || 'Open conversation' }}
                </span>
              </div>
            </div>

            <div class="message-arrow">›</div>
          </button>
        </div>

        <!-- Pagination -->
        <div v-if="meta.pages > 1" class="pagination">
          <el-button
            size="small"
            :disabled="page <= 1 || loading"
            @click="changePage(page - 1)"
          >
            Previous
          </el-button>

          <span>Page {{ page }} of {{ meta.pages }}</span>

          <el-button
            size="small"
            :disabled="page >= meta.pages || loading"
            @click="changePage(page + 1)"
          >
            Next
          </el-button>
        </div>
      </div>
    </div>

    <!-- Conversation drawer -->
    <el-drawer
      v-model="drawerVisible"
      :title="selectedConversation?.name || 'Conversation'"
      direction="rtl"
      size="min(680px, 95vw)"
      :destroy-on-close="false"
      class="conversation-drawer"
      @closed="closeConversation"
    >
      <template #header>
        <div class="drawer-header">
          <div>
            <p class="eyebrow">CUSTOMER CONVERSATION</p>
            <h2>{{ selectedConversation?.name || 'Conversation' }}</h2>
            <p>{{ selectedConversation?.email }}</p>
          </div>

          <el-tag
            v-if="selectedConversation"
            :type="statusTagType(selectedConversation.status)"
            effect="light"
          >
            {{ statusLabel(selectedConversation.status) }}
          </el-tag>
        </div>
      </template>

      <div v-if="threadLoading" class="drawer-loading">
        <el-skeleton :rows="6" animated />
      </div>

      <div v-else-if="selectedConversation" class="drawer-body">
        <!-- Customer details -->
        <div class="customer-details">
          <div>
            <span>Enquiry type</span>
            <strong>{{ selectedConversation.enquiry_type }}</strong>
          </div>

          <div>
            <span>Submitted</span>
            <strong>{{ formatDate(selectedConversation.created_at) }}</strong>
          </div>

          <div>
            <span>Email</span>
            <strong>{{ selectedConversation.email }}</strong>
          </div>
        </div>

        <!-- Status control -->
        <div class="status-control">
          <label>Conversation status</label>

          <el-select
            :model-value="selectedConversation.status"
            :disabled="statusUpdating"
            @change="updateStatus"
          >
            <el-option label="New" value="new" />
            <el-option label="In progress" value="in_progress" />
            <el-option label="Resolved" value="resolved" />
            <el-option label="Spam" value="spam" />
          </el-select>
        </div>

        <div class="conversation-divider">
          <span>CONVERSATION HISTORY</span>
        </div>

        <!-- Thread -->
        <div ref="threadContainer" class="thread-list">
          <div
            v-for="entry in threadMessages"
            :key="entry.id"
            class="thread-entry"
            :class="{
              'thread-entry-admin': entry.author_type === 'admin' && !entry.is_internal,
              'thread-entry-visitor': entry.author_type === 'visitor',
              'thread-entry-note': entry.is_internal
            }"
          >
            <div class="thread-entry-heading">
              <strong>
                <template v-if="entry.is_internal">
                  Internal note
                </template>
                <template v-else-if="entry.author_type === 'visitor'">
                  {{ selectedConversation.name }}
                </template>
                <template v-else>
                  Admin
                </template>
              </strong>

              <span>{{ formatDate(entry.created_at) }}</span>
            </div>

            <div class="thread-bubble">
              <p>{{ entry.body }}</p>
            </div>

            <span v-if="entry.is_internal" class="internal-label">
              ONLY VISIBLE TO ADMINS
            </span>
          </div>

          <div v-if="!threadMessages.length" class="thread-empty">
            No conversation messages yet.
          </div>
        </div>

        <!-- Composer -->
        <div class="composer">
          <div class="composer-tabs">
            <button
              type="button"
              :class="{ active: composerMode === 'reply' }"
              @click="composerMode = 'reply'"
            >
              Reply to customer
            </button>

            <button
              type="button"
              :class="{ active: composerMode === 'note' }"
              @click="composerMode = 'note'"
            >
              Internal note
            </button>
          </div>

          <el-input
            v-model="composerText"
            type="textarea"
            :rows="4"
            maxlength="10000"
            show-word-limit
            :placeholder="
              composerMode === 'note'
                ? 'Write a private note for other admins...'
                : 'Write your reply to the customer...'
            "
          />

          <p
            v-if="composerMode === 'note'"
            class="note-warning"
          >
            Internal notes are private and will not be sent to the customer.
          </p>

          <p v-if="threadError" class="form-error">
            {{ threadError }}
          </p>

          <div class="composer-footer">
            <span>
              {{ composerMode === 'note' ? 'Private admin note' : 'Customer will see this reply' }}
            </span>

            <el-button
              type="primary"
              :loading="sending"
              :disabled="!composerText.trim()"
              @click="sendMessage"
            >
              {{ composerMode === 'note' ? 'Add note' : 'Send reply' }}
            </el-button>
          </div>
        </div>
      </div>

      <div v-else class="empty-state">
        <p>Unable to load this conversation.</p>
      </div>
    </el-drawer>
  </MainLayout>
</template>

<script setup lang="ts">
import {
  ref,
  computed,
  watch,
  onMounted,
  onBeforeUnmount,
  nextTick
} from 'vue'

import MainLayout from '@/layouts/MainLayout.vue'
import { supabase } from '@/services/supabase.js'
import { ElMessage } from 'element-plus'

interface InboxMessage {
  id: string
  name: string
  email: string
  enquiry_type: string
  message: string
  status: string
  created_at: string
  last_message_at?: string
  last_message_preview?: string
  last_admin_read_at?: string | null
  last_visitor_read_at?: string | null
  unread?: boolean
}

interface ThreadMessage {
  id: string
  author_type: 'visitor' | 'admin'
  body: string
  created_at: string
  is_internal?: boolean
}

interface Conversation extends InboxMessage {
  replies?: ThreadMessage[]
}

interface ListMeta {
  page: number
  limit: number
  total: number
  pages: number
  unread: number
}

const messages = ref<InboxMessage[]>([])
const selectedConversation = ref<Conversation | null>(null)
const threadMessages = ref<ThreadMessage[]>([])

const loading = ref(false)
const threadLoading = ref(false)
const sending = ref(false)
const statusUpdating = ref(false)

const drawerVisible = ref(false)

const search = ref('')
const statusFilter = ref('all')

const page = ref(1)
const limit = 20

const meta = ref<ListMeta>({
  page: 1,
  limit,
  total: 0,
  pages: 1,
  unread: 0
})

const errorMessage = ref('')
const threadError = ref('')

const composerMode = ref<'reply' | 'note'>('reply')
const composerText = ref('')

const threadContainer = ref<HTMLElement | null>(null)

let searchTimer: ReturnType<typeof setTimeout> | null = null
let refreshTimer: ReturnType<typeof setInterval> | null = null

const unreadCount = computed(() => meta.value.unread || 0)

function isUnread(item: InboxMessage) {
  if (typeof item.unread === 'boolean') return item.unread

  if (!item.last_message_at) return false

  if (!item.last_admin_read_at) return true

  return (
    new Date(item.last_message_at).getTime() >
    new Date(item.last_admin_read_at).getTime()
  )
}

function initials(name?: string) {
  return (name || 'C')
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map(part => part.charAt(0).toUpperCase())
    .join('')
}

function statusLabel(status?: string) {
  const labels: Record<string, string> = {
    new: 'New',
    in_progress: 'In progress',
    resolved: 'Resolved',
    spam: 'Spam'
  }

  return labels[status || ''] || 'New'
}

function statusTagType(status?: string) {
  const types: Record<string, string> = {
    new: 'warning',
    in_progress: 'primary',
    resolved: 'success',
    spam: 'danger'
  }

  return types[status || ''] || 'info'
}

function formatDate(value?: string) {
  if (!value) return '—'

  return new Intl.DateTimeFormat('en-NG', {
    dateStyle: 'medium',
    timeStyle: 'short'
  }).format(new Date(value))
}

function formatRelativeDate(value?: string) {
  if (!value) return ''

  const date = new Date(value)
  const now = new Date()

  if (date.toDateString() === now.toDateString()) {
    return date.toLocaleTimeString('en-NG', {
      hour: '2-digit',
      minute: '2-digit'
    })
  }

  return date.toLocaleDateString('en-NG', {
    day: 'numeric',
    month: 'short'
  })
}

async function invokeAdmin(payload: Record<string, unknown>) {
  const { data, error } = await supabase.functions.invoke(
    'admin-messages',
    { body: payload }
  )

  if (error) {
    console.error('Admin messages function error:', error)
    throw new Error(error.message || 'The request could not be completed.')
  }

  if (!data?.success) {
    throw new Error(data?.message || 'The request could not be completed.')
  }

  return data
}

async function loadMessages() {
  loading.value = true
  errorMessage.value = ''

  try {
    const data = await invokeAdmin({
      action: 'list',
      page: page.value,
      limit,
      status: statusFilter.value,
      search: search.value.trim()
    })

    messages.value = data.messages || []

    meta.value = {
      page: data.meta?.page ?? page.value,
      limit: data.meta?.limit ?? limit,
      total: data.meta?.total ?? messages.value.length,
      pages: data.meta?.pages ?? 1,
      unread: data.meta?.unread ?? 0
    }
  } catch (error: any) {
    console.error('Unable to load messages:', error)
    errorMessage.value = error.message || 'Unable to load messages.'
  } finally {
    loading.value = false
  }
}

async function openConversation(item: InboxMessage) {
  drawerVisible.value = true
  threadLoading.value = true
  threadError.value = ''
  composerText.value = ''
  composerMode.value = 'reply'

  selectedConversation.value = item as Conversation
  threadMessages.value = []

  try {
    const data = await invokeAdmin({
      action: 'get',
      id: item.id
    })

    const conversation = data.conversation as Conversation

    selectedConversation.value = conversation

    threadMessages.value = (conversation.replies || []).map(reply => ({
      ...reply,
      is_internal: Boolean(reply.is_internal)
    }))

    // Mark this conversation as read for the admin.
    await invokeAdmin({
      action: 'mark_read',
      id: item.id
    })

    // Update unread state in the inbox.
    const inboxItem = messages.value.find(message => message.id === item.id)

    if (inboxItem) {
      inboxItem.unread = false
      inboxItem.last_admin_read_at = new Date().toISOString()
    }

    await loadMessages()
    await scrollThreadToBottom()
  } catch (error: any) {
    console.error('Unable to open conversation:', error)
    threadError.value = error.message || 'Unable to load this conversation.'
  } finally {
    threadLoading.value = false
  }
}

async function sendMessage() {
  if (!selectedConversation.value) return

  const body = composerText.value.trim()

  if (!body || sending.value) return

  sending.value = true
  threadError.value = ''

  try {
    const action = composerMode.value === 'note'
      ? 'add_note'
      : 'reply'

    const data = await invokeAdmin({
      action,
      id: selectedConversation.value.id,
      body
    })

    if (data.reply) {
      threadMessages.value.push({
        ...data.reply,
        is_internal: composerMode.value === 'note'
      })
    }

    composerText.value = ''

    if (composerMode.value === 'reply') {
      ElMessage.success('Reply sent successfully.')

      if (selectedConversation.value.status === 'resolved') {
        selectedConversation.value.status = 'in_progress'
      }
    } else {
      ElMessage.success('Internal note added.')
    }

    await loadMessages()
    await scrollThreadToBottom()
  } catch (error: any) {
    console.error('Unable to send message:', error)
    threadError.value = error.message || 'Unable to send this message.'
  } finally {
    sending.value = false
  }
}

async function updateStatus(status: string) {
  if (!selectedConversation.value) return

  const previousStatus = selectedConversation.value.status

  if (status === previousStatus) return

  statusUpdating.value = true

  try {
    const data = await invokeAdmin({
      action: 'set_status',
      id: selectedConversation.value.id,
      status
    })

    selectedConversation.value = {
      ...selectedConversation.value,
      ...(data.conversation || {}),
      status
    }

    ElMessage.success('Conversation status updated.')
    await loadMessages()
  } catch (error: any) {
    console.error('Unable to update status:', error)
    ElMessage.error(error.message || 'Unable to update status.')
  } finally {
    statusUpdating.value = false
  }
}

async function scrollThreadToBottom() {
  await nextTick()

  if (threadContainer.value) {
    threadContainer.value.scrollTop =
      threadContainer.value.scrollHeight
  }
}

function changePage(nextPage: number) {
  page.value = nextPage
  loadMessages()
}

function closeConversation() {
  selectedConversation.value = null
  threadMessages.value = []
  composerText.value = ''
  threadError.value = ''
}

watch([search, statusFilter], () => {
  page.value = 1

  if (searchTimer) clearTimeout(searchTimer)

  searchTimer = setTimeout(() => {
    loadMessages()
  }, 350)
})

onMounted(() => {
  loadMessages()

  refreshTimer = setInterval(() => {
    if (!drawerVisible.value) {
      loadMessages()
    }
  }, 30000)
})

onBeforeUnmount(() => {
  if (searchTimer) clearTimeout(searchTimer)
  if (refreshTimer) clearInterval(refreshTimer)
})
</script>

<style scoped>
.messages-page {
  padding: 28px;
  color: #29231f;
}

.page-header {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  gap: 20px;
  margin-bottom: 26px;
}

.eyebrow {
  margin: 0 0 8px;
  color: #a17c56;
  font-size: 10px;
  font-weight: 800;
  letter-spacing: 0.18em;
}

.page-header h1 {
  margin: 0;
  font-family: Georgia, serif;
  font-size: 30px;
  font-weight: 600;
}

.subtitle {
  margin: 8px 0 0;
  color: #898078;
  font-size: 13px;
}

.header-actions {
  display: flex;
  align-items: center;
  gap: 16px;
}

.unread-summary {
  display: flex;
  align-items: center;
  gap: 6px;
  color: #81776f;
  font-size: 12px;
}

.unread-summary strong {
  color: #29231f;
}

.unread-dot,
.avatar-unread {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: #d97745;
}

.stats-grid {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 14px;
  margin-bottom: 22px;
}

.stat-card {
  padding: 18px 20px;
  border: 1px solid #eee8e2;
  border-radius: 13px;
  background: white;
}

.stat-label {
  display: block;
  margin-bottom: 9px;
  color: #958b82;
  font-size: 12px;
}

.stat-card strong {
  font-size: 25px;
  font-weight: 650;
}

.stat-card .stat-unread {
  color: #c27643;
}

.inbox-toolbar {
  display: flex;
  gap: 12px;
  margin-bottom: 18px;
}

.search-input {
  max-width: 420px;
}

.status-filter {
  width: 180px;
}

.inbox-card {
  overflow: hidden;
  border: 1px solid #eee8e2;
  border-radius: 14px;
  background: white;
}

.inbox-heading {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 15px;
  padding: 21px 22px;
  border-bottom: 1px solid #f1ece7;
}

.inbox-heading h2 {
  margin: 0;
  font-size: 15px;
  font-weight: 700;
}

.inbox-heading p {
  margin: 6px 0 0;
  color: #968d85;
  font-size: 12px;
}

.result-count {
  color: #968d85;
  font-size: 12px;
}

.message-row {
  display: flex;
  width: 100%;
  align-items: center;
  gap: 15px;
  padding: 17px 22px;
  border: 0;
  border-bottom: 1px solid #f4f0ec;
  background: white;
  text-align: left;
  cursor: pointer;
  transition: background 0.15s ease;
}

.message-row:last-child {
  border-bottom: 0;
}

.message-row:hover {
  background: #fcfaf8;
}

.message-unread {
  background: #fffdfb;
}

.message-avatar {
  position: relative;
  display: flex;
  width: 43px;
  height: 43px;
  flex: 0 0 43px;
  align-items: center;
  justify-content: center;
  border-radius: 50%;
  background: #f3eae1;
  color: #8d6749;
  font-size: 13px;
  font-weight: 700;
}

.avatar-unread {
  position: absolute;
  top: 0;
  right: 0;
  border: 2px solid white;
}

.message-content {
  min-width: 0;
  flex: 1;
}

.message-topline,
.message-middle,
.message-bottomline {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}

.customer-name {
  overflow: hidden;
  color: #332b25;
  font-size: 13px;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.message-unread .customer-name {
  font-weight: 800;
}

.message-date {
  flex: 0 0 auto;
  color: #a49a91;
  font-size: 11px;
}

.message-middle {
  justify-content: flex-start;
  margin-top: 5px;
}

.customer-email {
  overflow: hidden;
  color: #968c83;
  font-size: 11px;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.message-bottomline {
  justify-content: flex-start;
  margin-top: 8px;
  overflow: hidden;
}

.enquiry-type {
  flex: 0 0 auto;
  color: #a17c56;
  font-size: 11px;
  font-weight: 650;
}

.message-preview {
  overflow: hidden;
  color: #8d857e;
  font-size: 11px;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.message-arrow {
  flex: 0 0 auto;
  color: #b8aea5;
  font-size: 25px;
}

.loading-state,
.empty-state {
  padding: 55px 25px;
  text-align: center;
}

.empty-icon {
  margin-bottom: 12px;
  color: #b59a80;
  font-size: 30px;
}

.empty-state h3 {
  margin: 0 0 8px;
  font-family: Georgia, serif;
  font-size: 20px;
}

.empty-state p {
  color: #958b82;
  font-size: 13px;
}

.pagination {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 18px;
  padding: 17px;
  border-top: 1px solid #f1ece7;
  color: #8d837a;
  font-size: 12px;
}

.drawer-header {
  display: flex;
  width: 100%;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}

.drawer-header h2 {
  margin: 0;
  color: #29231f;
  font-family: Georgia, serif;
  font-size: 22px;
}

.drawer-header > div > p:last-child {
  margin: 5px 0 0;
  color: #948a82;
  font-size: 12px;
}

.drawer-body {
  display: flex;
  min-height: 100%;
  flex-direction: column;
}

.customer-details {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 16px;
  padding: 4px 0 20px;
}

.customer-details div {
  display: flex;
  min-width: 0;
  flex-direction: column;
  gap: 5px;
}

.customer-details span,
.status-control label {
  color: #a0968d;
  font-size: 11px;
}

.customer-details strong {
  overflow-wrap: anywhere;
  color: #413830;
  font-size: 12px;
  font-weight: 600;
}

.status-control {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 15px;
  padding: 15px 0;
  border-top: 1px solid #f0ebe6;
  border-bottom: 1px solid #f0ebe6;
}

.status-control .el-select {
  width: 160px;
}

.conversation-divider {
  display: flex;
  align-items: center;
  gap: 12px;
  margin: 22px 0 15px;
  color: #a0968d;
  font-size: 10px;
  font-weight: 800;
  letter-spacing: 0.12em;
}

.conversation-divider::after {
  height: 1px;
  flex: 1;
  background: #eee8e2;
  content: '';
}

.thread-list {
  display: flex;
  min-height: 180px;
  max-height: 390px;
  flex-direction: column;
  gap: 18px;
  overflow-y: auto;
  padding: 5px 2px 20px;
}

.thread-entry {
  max-width: 88%;
}

.thread-entry-admin {
  align-self: flex-end;
}

.thread-entry-visitor {
  align-self: flex-start;
}

.thread-entry-note {
  max-width: 100%;
  align-self: stretch;
}

.thread-entry-heading {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  margin-bottom: 7px;
  color: #9a9087;
  font-size: 10px;
}

.thread-entry-heading strong {
  color: #64594f;
  font-size: 11px;
}

.thread-bubble {
  padding: 12px 14px;
  border: 1px solid #eee8e2;
  border-radius: 12px;
  background: #faf8f6;
  color: #51473f;
  font-size: 13px;
  line-height: 1.7;
}

.thread-bubble p {
  margin: 0;
  overflow-wrap: anywhere;
  white-space: pre-wrap;
}

.thread-entry-admin .thread-bubble {
  border-color: #eaded2;
  background: #f7eee6;
}

.thread-entry-note .thread-bubble {
  border-color: #f0d8a9;
  background: #fff8e9;
}

.internal-label {
  display: block;
  margin-top: 6px;
  color: #a8792b;
  font-size: 9px;
  font-weight: 800;
  letter-spacing: 0.08em;
}

.thread-empty {
  padding: 30px 10px;
  color: #a0968d;
  font-size: 12px;
  text-align: center;
}

.composer {
  margin-top: auto;
  padding-top: 18px;
  border-top: 1px solid #eee8e2;
}

.composer-tabs {
  display: flex;
  gap: 18px;
  margin-bottom: 13px;
}

.composer-tabs button {
  padding: 0 0 8px;
  border: 0;
  border-bottom: 2px solid transparent;
  background: transparent;
  color: #938980;
  font-size: 12px;
  cursor: pointer;
}

.composer-tabs button.active {
  border-color: #a17c56;
  color: #765638;
  font-weight: 700;
}

.note-warning {
  margin: 8px 0 0;
  color: #a8792b;
  font-size: 11px;
}

.form-error {
  margin: 10px 0 0;
  color: #d04d4d;
  font-size: 12px;
}

.composer-footer {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  margin-top: 13px;
}

.composer-footer > span {
  color: #9a9087;
  font-size: 10px;
}

.drawer-loading {
  padding: 15px 5px;
}

@media (max-width: 700px) {
  .messages-page {
    padding: 18px 12px;
  }

  .page-header {
    flex-direction: column;
  }

  .header-actions {
    width: 100%;
    justify-content: space-between;
  }

  .stats-grid {
    gap: 8px;
  }

  .stat-card {
    padding: 13px 11px;
  }

  .stat-card strong {
    font-size: 20px;
  }

  .inbox-toolbar {
    flex-direction: column;
  }

  .search-input,
  .status-filter {
    width: 100%;
    max-width: none;
  }

  .message-row {
    gap: 10px;
    padding: 14px 12px;
  }

  .message-avatar {
    width: 36px;
    height: 36px;
    flex-basis: 36px;
  }

  .message-bottomline {
    align-items: flex-start;
    flex-direction: column;
    gap: 4px;
  }

  .message-preview {
    max-width: 100%;
  }

  .message-arrow {
    display: none;
  }

  .customer-details {
    grid-template-columns: 1fr;
  }
}
</style>
