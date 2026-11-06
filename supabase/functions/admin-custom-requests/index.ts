import { handle, reply, readJson, requireMethod, text, HttpError } from '../_shared/http.ts'
import { requireRole } from '../_shared/supabaseAdmin.ts'
const statuses=['new','reviewing','quoted','awaiting_customer','approved','in_production','completed','declined','cancelled']
Deno.serve(handle(async(req,cors)=>{
 const {db,user}=await requireRole(req,['owner','admin','support'])
 if(req.method==='GET'){
  const u=new URL(req.url); let q=db.from('custom_requests').select('*,files:custom_request_files(*)').order('created_at',{ascending:false})
  const s=u.searchParams.get('status'); if(s) q=q.eq('status',s)
  const {data,error}=await q.limit(Math.min(Number(u.searchParams.get('limit')||100),200))
  if(error) throw new HttpError(500,'Could not load custom requests')
  return reply(cors,{data})
 }
 if(req.method==='PATCH'){
  const b=await readJson(req), id=text(b.id,80), status=text(b.status,40)
  if(!id||!statuses.includes(status)) throw new HttpError(400,'Valid id and status are required')
  const patch:Record<string,unknown>={status}
  if('quote_kobo' in b) { if(b.quote_kobo!==null&&(!Number.isSafeInteger(b.quote_kobo)||Number(b.quote_kobo)<0)) throw new HttpError(400,'Invalid quote_kobo'); patch.quote_kobo=b.quote_kobo }
  if('internal_notes' in b) patch.internal_notes=text(b.internal_notes,5000)
  if('agreed_timeline' in b) patch.agreed_timeline=text(b.agreed_timeline,500)
  const {data,error}=await db.from('custom_requests').update(patch).eq('id',id).select().single()
  if(error) throw new HttpError(400,'Could not update request',error.message)
  await db.from('audit_logs').insert({actor_user_id:user.id,action:'custom_request.update',entity_type:'custom_request',entity_id:id,metadata:{status}})
  return reply(cors,{data})
 }
 throw new HttpError(405,'Method not allowed')
}))
