<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { ElMessage, ElMessageBox, type FormInstance, type FormRules } from 'element-plus'
import MainLayout from '@/layouts/MainLayout.vue'
import ApiService from '@/services/api'

type Member = { user_id: string; full_name: string; email: string; phone: string; role: string; status: string; last_sign_in_at: string | null; can_manage: boolean }
type AccountForm = { full_name: string; email: string; phone: string; password: string; role: string }
type Action = 'delete_user' | 'remove_role' | 'suspend_user' | 'activate_user'
const endpoint = '/admin-users'
const members = ref<Member[]>([])
const roles = ref<string[]>([])
const loading = ref(false)
const busy = ref(false)
const error = ref('')
const dialogError = ref('')
const q = ref('')
const roleFilter = ref('')
const statusFilter = ref('')
const modal = ref(false)
const editing = ref('')
const formRef = ref<FormInstance>()
const labels: Record<string,string> = { owner:'Owner', admin:'Administrator', catalog_manager:'Catalog Manager', order_manager:'Order Manager', support:'Support' }
const statuses = ['Active', 'Unconfirmed', 'Suspended']
const emptyForm = (): AccountForm => ({ full_name:'', email:'', phone:'', password:'', role: roles.value.includes('support') ? 'support' : roles.value[0] || '' })
const form = ref<AccountForm>(emptyForm())
const roleLabel = (r:string) => labels[r] || r
const filtered = computed(() => members.value.filter(m => `${m.full_name} ${m.email} ${m.phone}`.toLowerCase().includes(q.value.trim().toLowerCase()) && (!roleFilter.value || m.role === roleFilter.value) && (!statusFilter.value || m.status === statusFilter.value)))
const cards = computed(() => [{label:'Total users',value:members.value.length,icon:'mdi-account-group-outline'}, ...statuses.map((s,i) => ({label:s,value:members.value.filter(m=>m.status===s).length,icon:['mdi-account-check-outline','mdi-email-clock-outline','mdi-account-lock-outline'][i]}))])
const rules: FormRules<AccountForm> = {
  full_name: [{ required:true, whitespace:true, message:'Enter a full name', trigger:'blur' }, {max:120,message:'Maximum 120 characters',trigger:'blur'}],
  email: [{required:true,message:'Enter an email address',trigger:'blur'},{type:'email',message:'Enter a valid email address',trigger:'blur'},{max:254,message:'Email is too long',trigger:'blur'}],
  phone: [{max:40,message:'Maximum 40 characters',trigger:'blur'}],
  role: [{required:true,message:'Select a role',trigger:'change'}],
  password: [{trigger:'blur',validator:(_rule,value:string,done) => {
    if (!value && editing.value) return done()
    if (!value || value.length < 12 || new TextEncoder().encode(value).length > 72) return done(new Error('Use at least 12 characters and at most 72 UTF-8 bytes'))
    done()
  }}]
}
function message(e:unknown) { return e instanceof Error ? e.message : typeof e === 'object' && e !== null && 'message' in e ? String(e.message) : 'Operation failed. Please try again.' }
async function load() {
  loading.value=true; error.value=''
  try { const d=await ApiService.get<{members:Member[];roles:string[]}>(endpoint); members.value=d.members; roles.value=d.roles }
  catch(e) { error.value=message(e) }
  finally { loading.value=false }
}
function open(m?:Member) {
  editing.value=m?.user_id || ''; dialogError.value=''
  form.value=m ? {full_name:m.full_name,email:m.email,phone:m.phone,password:'',role:m.role} : emptyForm()
  modal.value=true
}
function resetDialog() { form.value=emptyForm(); editing.value=''; dialogError.value=''; formRef.value?.clearValidate() }
async function save() {
  if (busy.value || !formRef.value) return
  if (!await formRef.value.validate().catch(()=>false)) return
  if (busy.value) return
  busy.value=true; dialogError.value=''
  const {password,...details}=form.value
  try {
    await ApiService.post(endpoint,{...details,full_name:details.full_name.trim(),email:details.email.trim(),phone:details.phone.trim(),...(password?{password}:{}),...(editing.value?{user_id:editing.value}:{}),action:editing.value?'update_user':'create_user'})
    ElMessage.success(editing.value?'User updated successfully':'User created successfully')
    modal.value=false; await load()
  } catch(e) { dialogError.value=message(e) }
  finally { busy.value=false }
}
const actions: Record<Action,{title:string;description:string;success:string}> = {
  delete_user:{title:'Delete user',description:'Permanently delete this account? This cannot be undone.',success:'User deleted'},
  remove_role:{title:'Remove access',description:'Remove staff permissions without deleting this account?',success:'Staff access removed'},
  suspend_user:{title:'Suspend user',description:'Prevent this user from signing in?',success:'User suspended'},
  activate_user:{title:'Activate user',description:'Restore sign-in access for this user?',success:'User activated'}
}
async function action(m:Member,a:Action) {
  if (busy.value || !m.can_manage) return
  const config=actions[a]
  try { await ElMessageBox.confirm(`${config.description} (${m.email})`,config.title,{type:'warning',confirmButtonText:config.title,cancelButtonText:'Cancel',customClass:'staff-confirm',closeOnClickModal:false}) } catch { return }
  if (busy.value) return
  busy.value=true
  try { await ApiService.post(endpoint,{action:a,user_id:m.user_id}); ElMessage.success(config.success); await load() }
  catch(e) { ElMessage.error(message(e)) }
  finally { busy.value=false }
}
function initials(m:Member) { return (m.full_name || m.email || '?').trim().split(/\s+/).slice(0,2).map(s=>s[0]).join('').toUpperCase() }
onMounted(load)
</script>

<template>
  <MainLayout>
    <section class="users">
      <header class="page-header">
        <div><small class="eyebrow">Administration / Team</small><h1>User management</h1><p>Manage staff accounts and access permissions.</p></div>
        <el-button class="primary" :disabled="busy || loading || !roles.length" @click="open()"><i class="mdi mdi-account-plus-outline" /> Create user</el-button>
      </header>
      <div class="stats">
        <article v-for="c in cards" :key="c.label"><div><small>{{ c.label }}</small><h2>{{ c.value }}</h2></div><span class="stat-icon"><i :class="`mdi ${c.icon}`" /></span></article>
      </div>
      <el-alert v-if="error" :title="error" type="error" show-icon :closable="false" class="page-error" />
      <div class="panel">
        <div class="filters">
          <el-input v-model="q" clearable placeholder="Search name, email or phone" aria-label="Search users" class="search"><template #prefix><i class="mdi mdi-magnify" /></template></el-input>
          <el-select v-model="roleFilter" aria-label="Filter role" class="filter-select"><el-option label="All roles" value="" /><el-option v-for="(label,r) in labels" :key="r" :label="label" :value="r" /></el-select>
          <el-select v-model="statusFilter" aria-label="Filter status" class="filter-select"><el-option label="All statuses" value="" /><el-option v-for="s in statuses" :key="s" :label="s" :value="s" /></el-select>
          <el-button :loading="loading" :disabled="busy" @click="load"><i class="mdi mdi-refresh" /> Refresh</el-button>
        </div>
        <div class="scroll" v-loading="loading">
          <table><thead><tr><th>User</th><th>Role</th><th>Status</th><th>Last sign-in</th><th>Actions</th></tr></thead>
            <tbody><tr v-for="m in filtered" :key="m.user_id">
              <td><div class="identity"><span class="avatar">{{ initials(m) }}</span><div><strong>{{ m.full_name || 'Unnamed user' }}</strong><small>{{ m.email }}</small></div></div></td>
              <td>{{ roleLabel(m.role) }}</td><td><span :class="['pill',m.status.toLowerCase()]">{{ m.status }}</span></td>
              <td>{{ m.last_sign_in_at ? new Date(m.last_sign_in_at).toLocaleString() : 'Never' }}</td>
              <td><div v-if="m.can_manage" class="actions">
                <el-button text :disabled="busy" @click="open(m)"><i class="mdi mdi-pencil-outline" /> Edit</el-button>
                <el-dropdown trigger="click" :disabled="busy" @command="(a:Action)=>action(m,a)"><el-button text aria-label="More user actions"><i class="mdi mdi-dots-vertical" /></el-button><template #dropdown><el-dropdown-menu>
                  <el-dropdown-item :command="m.status==='Suspended'?'activate_user':'suspend_user'">{{ m.status==='Suspended'?'Activate':'Suspend' }}</el-dropdown-item>
                  <el-dropdown-item command="remove_role">Remove access</el-dropdown-item><el-dropdown-item divided command="delete_user" class="danger-item">Delete user</el-dropdown-item>
                </el-dropdown-menu></template></el-dropdown>
              </div><small v-else><i class="mdi mdi-shield-lock-outline" /> Protected</small></td>
            </tr></tbody>
          </table><el-empty v-if="!loading && !filtered.length" description="No users found" :image-size="80" />
        </div>
      </div>
      <el-dialog v-model="modal" class="staff-dialog" width="min(600px, calc(100vw - 32px))" append-to-body destroy-on-close :close-on-click-modal="false" :close-on-press-escape="!busy" :show-close="!busy" @closed="resetDialog">
        <template #header="{ titleId, titleClass }"><div class="dialog-heading"><span class="dialog-icon"><i :class="editing?'mdi mdi-account-edit-outline':'mdi mdi-account-plus-outline'" /></span><div><h2 :id="titleId" :class="titleClass">{{ editing?'Edit user':'Create new user' }}</h2><p>{{ editing?'Update account details and access permissions.':'Set up a new staff account and permissions.' }}</p></div></div></template>
        <el-alert v-if="dialogError" :title="dialogError" type="error" show-icon :closable="false" class="page-error" />
        <el-form ref="formRef" :model="form" :rules="rules" label-position="top" size="large" :disabled="busy" @submit.prevent="save">
          <div class="form-section">Personal information</div>
          <el-form-item label="Full name" prop="full_name"><el-input v-model="form.full_name" placeholder="Enter full name" maxlength="120" /></el-form-item>
          <div class="form-grid"><el-form-item label="Email address" prop="email"><el-input v-model="form.email" placeholder="name@example.com" type="email" /></el-form-item><el-form-item label="Phone number" prop="phone"><el-input v-model="form.phone" placeholder="Enter phone number" maxlength="40" /></el-form-item></div>
          <div class="form-section access-section">Account &amp; access</div>
          <el-form-item :label="editing?'New password (optional)':'Password'" prop="password" :required="!editing"><el-input v-model="form.password" type="password" show-password autocomplete="new-password" placeholder="Enter a secure password" /><small class="hint">{{ editing?'Leave blank to keep the existing password.':'Use at least 12 characters.' }}</small></el-form-item>
          <el-form-item label="Account role" prop="role"><el-select v-model="form.role" placeholder="Select account role" style="width:100%"><el-option v-for="r in roles" :key="r" :label="roleLabel(r)" :value="r" /></el-select></el-form-item>
          <div v-if="!editing" class="activation"><i class="mdi mdi-shield-check-outline" /><div><strong>Automatic account confirmation</strong><p>No verification email is required. The user can sign in immediately.</p></div></div>
        </el-form>
        <template #footer><div class="dialog-footer"><el-button :disabled="busy" @click="modal=false">Cancel</el-button><el-button class="primary" :loading="busy" @click="save"><i v-if="!busy" :class="editing?'mdi mdi-check':'mdi mdi-account-plus-outline'" />{{ editing?'Save changes':'Create user' }}</el-button></div></template>
      </el-dialog>
    </section>
  </MainLayout>
</template>

<style scoped>
.users{padding:24px;max-width:1500px;margin:auto;color:#392720;--el-color-primary:#c4623a;--el-border-radius-base:9px}.page-header,.filters,.actions,.identity{display:flex;align-items:center;gap:12px}.page-header{justify-content:space-between;flex-wrap:wrap;margin-bottom:24px}.eyebrow,.form-section{font-size:11px;font-weight:700;letter-spacing:.1em;text-transform:uppercase;color:#9a7567}h1{font-size:30px;font-weight:700;margin:6px 0}p,small{color:#89746b}small{display:block}.stats{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:16px;margin-bottom:24px}.stats article,.panel{background:white;border:1px solid #efe3dc;border-radius:16px;padding:20px}.stats article{display:flex;align-items:center;justify-content:space-between}.stats h2{font-size:28px;font-weight:700;margin:6px 0 0}.stat-icon,.avatar{display:grid;place-items:center;background:#fff1e8;color:#c4623a;flex-shrink:0}.stat-icon{width:44px;height:44px;border-radius:12px;font-size:23px}.avatar{width:38px;height:38px;border-radius:50%;font-weight:700}.filters{flex-wrap:wrap;margin-bottom:18px}.search{flex:1;min-width:180px}.filter-select{width:170px}.scroll{overflow:auto;min-height:100px}table{width:100%;border-collapse:collapse;text-align:left;white-space:nowrap}td,th{padding:15px 12px;border-bottom:1px solid #f1e8e2}th{font-size:12px;color:#9a7567;background:#fffaf7}td{font-size:13px}.pill{display:inline-block;padding:5px 10px;border-radius:20px;font-size:12px}.active{background:#e5f4e9;color:#267343}.unconfirmed{background:#fff1d8;color:#875700}.suspended{background:#fce9e9;color:#a32b2b}.page-error{margin-bottom:16px}.primary{--el-button-bg-color:#c4623a;--el-button-border-color:#c4623a;--el-button-text-color:white;--el-button-hover-bg-color:#ad583a;--el-button-hover-border-color:#ad583a;--el-button-hover-text-color:white;--el-button-active-bg-color:#98492d;--el-button-active-border-color:#98492d;--el-button-disabled-bg-color:#dfad96;--el-button-disabled-border-color:#dfad96;--el-button-disabled-text-color:white}.el-button i{margin-right:5px}.dialog-heading{display:flex;align-items:center;gap:14px;padding-right:24px}.dialog-icon{display:grid;place-items:center;width:48px;height:48px;flex-shrink:0;border-radius:14px;background:#fff1e8;color:#c4623a;font-size:25px}.dialog-heading h2{font-size:21px;font-weight:700;color:#392720;margin:0}.dialog-heading p{font-size:13px;margin:4px 0 0}.form-section{margin-bottom:16px}.access-section{border-top:1px solid #f0e4dd;padding-top:18px}.form-grid{display:grid;grid-template-columns:1fr 1fr;gap:16px}.hint{font-size:11px;line-height:1.5;margin-top:5px}.activation{display:flex;align-items:center;gap:12px;background:#fff7f1;border:1px solid #f5e3d7;padding:14px;border-radius:12px;color:#5a413a;font-size:13px}.activation i{font-size:25px;color:#c4623a}.activation p{font-size:12px;margin:4px 0 0;line-height:1.5}.dialog-footer{display:flex;justify-content:flex-end;gap:10px}.dialog-footer .el-button{margin:0;min-height:40px;padding:0 18px}@media(max-width:600px){.users{padding:14px}.panel{padding:12px}.form-grid{grid-template-columns:1fr;gap:0}.filter-select{flex:1;min-width:125px}.dialog-heading h2{font-size:18px}}
</style>
<style>
.staff-dialog.el-dialog{--el-color-primary:#c4623a;--el-border-radius-base:10px;--el-dialog-padding-primary:24px;border-radius:22px;padding:0;overflow:hidden;box-shadow:0 24px 80px #39272030;margin-top:clamp(16px,7vh,70px);max-height:calc(100dvh - 32px);display:flex;flex-direction:column}.staff-dialog .el-dialog__header{padding:22px 24px;margin:0;border-bottom:1px solid #f0e4dd}.staff-dialog .el-dialog__body{padding:24px;overflow-y:auto;min-height:0}.staff-dialog .el-dialog__footer{padding:16px 24px;border-top:1px solid #f0e4dd;background:#fffcfa}.staff-dialog .el-form-item__label{font-weight:600;color:#5a413a}.staff-dialog .el-input__wrapper,.staff-dialog .el-select__wrapper{border-radius:10px;box-shadow:0 0 0 1px #e8dcd5 inset}.staff-dialog .el-input__wrapper.is-focus,.staff-dialog .el-select__wrapper.is-focused{box-shadow:0 0 0 1px #c4623a inset}.staff-dialog .el-form-item.is-error .el-input__wrapper,.staff-dialog .el-form-item.is-error .el-select__wrapper{box-shadow:0 0 0 1px var(--el-color-danger) inset}.staff-confirm{--el-color-primary:#c4623a;border-radius:16px}.danger-item{color:#b42318!important}
</style>
