import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.4'
export function getAdminClient() {
 const url=Deno.env.get('SUPABASE_URL'); const key=Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
 if(!url||!key) throw new Error('Supabase server environment is not configured')
 return createClient(url,key,{auth:{autoRefreshToken:false,persistSession:false}})
}
export async function getAuthenticatedUser(req:Request) {
 const token=(req.headers.get('Authorization')||'').replace(/^Bearer\s+/i,'')
 if(!token) return null
 const {data,error}=await getAdminClient().auth.getUser(token)
 return error ? null : data.user
}
export async function requireRole(req: Request, roles: string[]) {
  const user = await getAuthenticatedUser(req)
  if (!user) throw new HttpError(401, 'Authentication required')
  const db = getAdminClient()
  const { data, error } = await db.from('user_roles').select('role').eq('user_id', user.id).maybeSingle()
  if (error || !data || !roles.includes(data.role)) throw new HttpError(403, 'Insufficient permissions')
  return { user, db, role: data.role as string }
}
