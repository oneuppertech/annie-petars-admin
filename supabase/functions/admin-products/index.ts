import { handle, reply, readJson, requireMethod, text, HttpError } from '../_shared/http.ts'
import { requireRole } from '../_shared/supabaseAdmin.ts'
Deno.serve(handle(async(req,cors)=>{
 const {db,user,role}=await requireRole(req,['owner','admin','catalog_manager'])
 if(req.method==='GET'){
  const url=new URL(req.url); let q=db.from('products').select('*,collection:collections(id,name,slug),images:product_images(*),variants:product_variants(*)').order('created_at',{ascending:false})
  const status=url.searchParams.get('status'); if(status) q=q.eq('status',status)
  const search=url.searchParams.get('q'); if(search) q=q.ilike('name',`%${search.slice(0,100)}%`)
  const {data,error}=await q.limit(Math.min(Number(url.searchParams.get('limit')||100),200))
  if(error) throw new HttpError(500,'Could not load products')
  return reply(cors,{data})
 }
 if(req.method==='POST'){
  const b=await readJson(req)
  const name=text(b.name,180), slug=text(b.slug,180).toLowerCase()
  if(!name||!slug||!Number.isSafeInteger(b.price_kobo)||Number(b.price_kobo)<0) throw new HttpError(400,'name, slug and price_kobo (integer minor units) are required')
  const row={name,slug,price_kobo:Number(b.price_kobo),currency:text(b.currency,3)||'NGN',
   collection_id:typeof b.collection_id==='string'?b.collection_id:null,sku:text(b.sku,80)||null,
   short_description:text(b.short_description,500)||null,description:text(b.description,10000)||null,
   fabric:text(b.fabric,200)||null,care_instructions:text(b.care_instructions,2000)||null,
   product_type:text(b.product_type,60)||'ready_to_wear',status:['draft','active','archived'].includes(String(b.status))?b.status:'draft',
   is_customisable:b.is_customisable===true,is_featured:b.is_featured===true,is_new_arrival:b.is_new_arrival===true,
   published_at:b.status==='active'?new Date().toISOString():null}
  const {data,error}=await db.from('products').insert(row).select().single()
  if(error) throw new HttpError(400,'Could not create product',error.message)
  await db.from('audit_logs').insert({actor_user_id:user.id,action:'product.create',entity_type:'product',entity_id:data.id,metadata:{role}})
  return reply(cors,{data},201)
 }
 if(req.method==='PATCH'){
  const b=await readJson(req); const id=text(b.id,80)
  if(!id) throw new HttpError(400,'Product id is required')
  const allowed=['name','slug','sku','short_description','description','fabric','care_instructions','product_type','status','currency','price_kobo','compare_at_price_kobo','collection_id','is_customisable','is_featured','is_new_arrival']
  const patch:Record<string,unknown>={}
  for(const k of allowed) if(k in b) patch[k]=b[k]
  if('price_kobo' in patch && (!Number.isSafeInteger(patch.price_kobo)||Number(patch.price_kobo)<0)) throw new HttpError(400,'Invalid price_kobo')
  if(patch.status==='active') patch.published_at=new Date().toISOString()
  const {data,error}=await db.from('products').update(patch).eq('id',id).select().single()
  if(error) throw new HttpError(400,'Could not update product',error.message)
  await db.from('audit_logs').insert({actor_user_id:user.id,action:'product.update',entity_type:'product',entity_id:id,metadata:{fields:Object.keys(patch)}})
  return reply(cors,{data})
 }
 if(req.method==='DELETE'){
  const url=new URL(req.url), id=url.searchParams.get('id')
  if(!id) throw new HttpError(400,'Product id is required')
  const {error}=await db.from('products').update({status:'archived'}).eq('id',id)
  if(error) throw new HttpError(400,'Could not archive product')
  await db.from('audit_logs').insert({actor_user_id:user.id,action:'product.archive',entity_type:'product',entity_id:id})
  return reply(cors,{success:true})
 }
 throw new HttpError(405,'Method not allowed')
}))
