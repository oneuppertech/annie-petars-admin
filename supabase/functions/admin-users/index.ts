import { handle, reply, readJson, requireMethod, HttpError } from '../_shared/http.ts'
import { requireRole } from '../_shared/supabaseAdmin.ts'

const roles = ['owner', 'admin', 'catalog_manager', 'order_manager', 'support']
const assignable = (role: string) =>
  roles.filter((r) => r !== 'owner' && (role === 'owner' || r !== 'admin'))
function check(error: any) {
  if (error) {
    console.error(error)
    throw new HttpError(500, 'User operation failed')
  }
}
function field(v: unknown, max: number) {
  if (typeof v !== 'string' || v.length > max) throw new HttpError(400, 'Invalid field')
  return v.trim()
}
Deno.serve(
  handle(async (req, cors) => {
    requireMethod(req, 'GET', 'POST')
    const { db, user, role } = await requireRole(req, ['owner', 'admin'])
    const ok = (body: unknown) => reply(cors, body)
    const allowed = assignable(role)
    if (req.method === 'GET') {
      const { data: members, error } = await db
        .from('user_roles')
        .select('user_id,role,created_at')
        .order('created_at')
      check(error)
      const ids = (members || []).map((m: any) => m.user_id)
      const profiles = ids.length
        ? await db.from('profiles').select('id,full_name,phone').in('id', ids)
        : { data: [], error: null }
      check(profiles.error)
      const map = new Map((profiles.data || []).map((p: any) => [p.id, p]))
      const rows = await Promise.all(
        (members || []).map(async (m: any) => {
          const { data, error } = await db.auth.admin.getUserById(m.user_id)
          check(error)
          const u = data.user
          const p: any = map.get(m.user_id)
          return {
            ...m,
            email: u.email,
            full_name: p?.full_name ?? '',
            phone: p?.phone ?? '',
            last_sign_in_at: u.last_sign_in_at,
            status:
              u.banned_until && Date.parse(u.banned_until) > Date.now()
                ? 'Suspended'
                : u.email_confirmed_at
                  ? 'Active'
                  : 'Unconfirmed',
            can_manage: m.user_id !== user.id && allowed.includes(m.role)
          }
        })
      )
      return ok({ members: rows, roles: allowed, actor_role: role })
    }
    const b = await readJson(req)
    const audit = async (action: string, id: string, metadata = {}) => {
      const { error } = await db
        .from('audit_logs')
        .insert({
          actor_user_id: user.id,
          action: 'team.' + action,
          entity_type: 'user',
          entity_id: id,
          metadata
        })
      check(error)
    }
    if (b.action === 'create_user') {
      const email = field(b.email, 254).toLowerCase()
      const name = field(b.full_name, 120)
      const phone = field(b.phone ?? '', 40)
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || !name || !allowed.includes(String(b.role)))
        throw new HttpError(400, 'Invalid user details')
      const password = b.password
      if (
        typeof password !== 'string' ||
        password.length < 12 ||
        password.length > 72 ||
        new TextEncoder().encode(password).length > 72
      )
        throw new HttpError(
          400,
          'Password must be at least 12 characters and at most 72 UTF-8 bytes'
        )
      const { data, error } = await db.auth.admin.createUser({
        email,
        password,
        email_confirm: true,
        user_metadata: { full_name: name }
      })
      if (error) {
        if (error.code === 'email_exists' || error.code === 'user_already_exists')
          throw new HttpError(409, 'Email already registered')
        check(error)
      }
      const id = data.user.id
      try {
        const p = await db.from('profiles').upsert({ id, full_name: name, phone })
        check(p.error)
        const r = await db
          .from('user_roles')
          .upsert(
            { user_id: id, role: b.role, updated_at: new Date().toISOString() },
            { onConflict: 'user_id' }
          )
        check(r.error)
      } catch (err) {
        // Best-effort cleanup; foreign keys require deleting dependent rows first.
        const r = await db.from('user_roles').delete().eq('user_id', id)
        const p = await db.from('profiles').delete().eq('id', id)
        const a = await db.auth.admin.deleteUser(id)
        if (r.error || p.error || a.error) console.error('Account cleanup failed', id)
        throw err
      }
      await audit('create_user', id, { role: b.role })
      return ok({ ok: true })
    }
    const id = String(b.user_id ?? '')
    if (!/^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(id) || id === user.id)
      throw new HttpError(400, 'Invalid target')
    const { data: target, error } = await db
      .from('user_roles')
      .select('role')
      .eq('user_id', id)
      .maybeSingle()
    check(error)
    if (!target || !allowed.includes(target.role))
      throw new HttpError(403, 'Cannot manage this user')
    switch (b.action) {
      case 'update_user': {
        if (!allowed.includes(String(b.role))) throw new HttpError(403, 'Role not allowed')
        const full_name = field(b.full_name, 120),
          phone = field(b.phone ?? '', 40)
        if (!full_name) throw new HttpError(400, 'Name required')
        const email = field(b.email, 254).toLowerCase()
        if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new HttpError(400, 'Invalid email')
        const password = b.password
        if (
          password !== undefined &&
          password !== '' &&
          (typeof password !== 'string' ||
            password.length < 12 ||
            new TextEncoder().encode(password).length > 72)
        )
          throw new HttpError(400, 'Invalid password length')
        const auth = await db.auth.admin.updateUserById(id, {
          email,
          email_confirm: true,
          user_metadata: { full_name },
          ...(password ? { password } : {})
        })
        if (auth.error?.code === 'email_exists' || auth.error?.code === 'user_already_exists')
          throw new HttpError(409, 'Email already registered')
        check(auth.error)
        check(
          (
            await db
              .from('user_roles')
              .update({ role: b.role, updated_at: new Date().toISOString() })
              .eq('user_id', id)
              .eq('role', target.role)
              .select()
              .single()
          ).error
        )
        check(
          (
            await db
              .from('profiles')
              .upsert({ id, full_name, phone, updated_at: new Date().toISOString() })
          ).error
        )
        break
      }
      case 'delete_user': {
        // Refuse hard deletion if historical records reference this account.
        // The database RPC performs the dependent deletes atomically.
        const { error: deletionError } = await db.rpc('delete_staff_account', {
          p_actor_id: user.id,
          p_target_id: id
        })
        if (deletionError?.code === '23503')
          throw new HttpError(409, 'User has linked records. Suspend or remove access instead.')
        if (deletionError?.code === '42501') throw new HttpError(403, 'Cannot delete this user')
        check(deletionError)
        return ok({ ok: true })
      }
      case 'suspend_user':
      case 'activate_user':
        check(
          (
            await db.auth.admin.updateUserById(id, {
              ban_duration: b.action === 'suspend_user' ? '876000h' : 'none'
            })
          ).error
        )
        break
      case 'remove_role':
        check(
          (
            await db
              .from('user_roles')
              .delete()
              .eq('user_id', id)
              .eq('role', target.role)
              .select()
              .single()
          ).error
        )
        break
      default:
        throw new HttpError(400, 'Unknown action')
    }
    await audit(String(b.action), id)
    return ok({ ok: true })
  })
)
