import { handle, reply, readJson, requireMethod, text, HttpError } from '../_shared/http.ts'
import { requireRole } from '../_shared/supabaseAdmin.ts'
const statuses=['pending_payment','paid','processing','ready_to_ship','shipped','delivered','cancelled','refunded']
Deno.serve(handle(async(req,cors)=>{
 const {db,user}=await requireRole(req,['owner','admin','order_manager'])
 if(req.method==='GET'){
  const u=new URL(req.url); let q=db.from('orders').select('*,items:order_items(*)').order('placed_at',{ascending:false})
  const status=u.searchParams.get('status'); if(status) q=q.eq('status',status)
  const search=u.searchParams.get('q'); if(search) q=q.or(`order_number.ilike.%${search.slice(0,60)}%,email.ilike.%${search.slice(0,120)}%`)
  const {data,error}=await q.limit(Math.min(Number(u.searchParams.get('limit')||100),200))
  if(error) throw new HttpError(500,'Could not load orders')
  return reply(cors,{data})
 }
 if(req.method==='PATCH'){
  const b=await readJson(req), id=text(b.id,80), status=text(b.status,40)
  if(!id||!statuses.includes(status)) throw new HttpError(400,'Valid order id and status are required')
  const patch:Record<string,unknown>={status}
  if('internal_note' in b) patch.internal_note=text(b.internal_note,4000)
  if('tracking_number' in b) patch.tracking_number=text(b.tracking_number,120)
  if('shipping_provider' in b) patch.shipping_provider=text(b.shipping_provider,120)
  // Deliberately do not let this endpoint set payment_status=paid; use verified provider webhooks.
  const {data,error}=await db.from('orders').update(patch).eq('id',id).select().single()
  if(error) throw new HttpError(400,'Could not update order',error.message)
  await db.from('audit_logs').insert({actor_user_id:user.id,action:'order.update',entity_type:'order',entity_id:id,metadata:{status}})
  return reply(cors,{data})
 }
 throw new HttpError(405,'Method not allowed')
}))
