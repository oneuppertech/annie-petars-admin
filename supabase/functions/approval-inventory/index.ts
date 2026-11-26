import { handle, reply, readJson, requireMethod, text, HttpError } from '../_shared/http.ts'

import { requireRole } from '../_shared/supabaseAdmin.ts'



// deno-lint-ignore no-explicit-any

type DB = any

type Obj = Record<string, unknown>



const READ = ['owner', 'admin', 'catalog_manager', 'order_manager']

const WRITE = ['owner', 'admin', 'catalog_manager']

const BUCKET = 'product-images'

const STATUSES = ['draft', 'active', 'archived']

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

const IMG_TYPES: Record<string, string> = {

  'image/jpeg': 'jpg',

  'image/png': 'png',

  'image/webp': 'webp',

  'image/gif': 'gif'

}



/* ---------- helpers ---------- */

const CURRENCIES = ['NGN', 'USD', 'GBP', 'EUR'] // keep in sync with the DB CHECK and the frontend list

const uid = (v: unknown) => {

  if (typeof v !== 'string' || !UUID.test(v)) throw new HttpError(400, 'Invalid id')

  return v

}

const int = (v: unknown, min = 0, max = 1_000_000_000_000, label = 'Value') => {

  const n = Number(v)

  if (!Number.isInteger(n) || n < min || n > max) throw new HttpError(400, `${label} is invalid`)

  return n

}

const optInt = (v: unknown, label?: string) =>

  v === null || v === undefined || v === '' ? null : int(v, 0, undefined, label)

const slugify = (s: string) =>

  s

    .toLowerCase()

    .replace(/['’]/g, '')

    .replace(/[^a-z0-9]+/g, '-')

    .replace(/^-+|-+$/g, '')

    .slice(0, 120)

const arr = (v: unknown, max: number): Obj[] => (Array.isArray(v) ? (v.slice(0, max) as Obj[]) : [])



function check(error: { code?: string; message?: string } | null) {

  if (!error) return

  if (error.code === '23505') throw new HttpError(409, 'That slug or SKU is already in use')

  if (error.code === 'P0002') throw new HttpError(404, 'Not found')

  if (error.message?.includes('stock_quantity'))

    throw new HttpError(400, 'Stock cannot go below zero')

  if (['23514', '22P02', '23503'].includes(error.code || ''))

    throw new HttpError(400, error.message || 'Invalid data')

  console.error(error)

  throw new HttpError(500, 'Database error')

}



const audit = (

  db: DB,

  userId: string,

  action: string,

  type: string,

  entityId: string | null,

  metadata: Obj = {}

) =>

  db

    .from('audit_logs')

    .insert({ actor_user_id: userId, action, entity_type: type, entity_id: entityId, metadata })

    .then(() => {}, console.error)



const storagePath = (url: string) => {

  const m = url.match(new RegExp(`/object/public/${BUCKET}/(.+)$`))

  return m ? decodeURIComponent(m[1]) : null

}

async function removeFiles(db: DB, urls: string[]) {

  const paths = urls.map(storagePath).filter(Boolean) as string[]

  if (paths.length) await db.storage.from(BUCKET).remove(paths).catch(console.error)

}



/* ---------- reads ---------- */

async function listCollections(db: DB) {

  const { data, error } = await db

    .from('collections')

    .select('*, products(count), collection_media(*)')

    .order('sort_order')

    .order('name')

  check(error)

  return {

    collections: (data || []).map(

      ({ products, ...c }: Obj & { products?: { count: number }[] }) => ({

        ...c,

        product_count: products?.[0]?.count ?? 0

      })

    )

  }

}



async function listProducts(db: DB, sp: URLSearchParams) {

  const page = Math.max(1, Number(sp.get('page')) || 1)

  const size = Math.min(100, Math.max(1, Number(sp.get('limit')) || 20))

  let q = db.from('products').select(

    `id,name,slug,sku,status,currency,price_kobo,compare_at_price_kobo,is_featured,is_new_arrival,collection_id,updated_at,

     collections(name),product_images(image_url,is_primary,sort_order),product_variants(stock_quantity,is_active)`,

    { count: 'exact' }

  )

  const status = sp.get('status')

  if (status) {

    if (!STATUSES.includes(status)) throw new HttpError(400, 'Invalid status')

    q = q.eq('status', status)

  }

  const col = sp.get('collection_id')

  if (col === 'none') q = q.is('collection_id', null)

  else if (col) q = q.eq('collection_id', uid(col))

  const s = (sp.get('q') || '')

    .replace(/[%,()*\\\\]/g, ' ')

    .trim()

    .slice(0, 80)

  if (s) q = q.or(`name.ilike.%${s}%,sku.ilike.%${s}%`)



  const { data, count, error } = await q

    .order('updated_at', { ascending: false })

    .range((page - 1) * size, page * size - 1)

  check(error)



  const products = (data || []).map(

    (

      p: Obj & { collections?: { name: string }; product_images: Obj[]; product_variants: Obj[] }

    ) => {

      const { collections, product_images, product_variants, ...rest } = p

      const imgs = [...product_images].sort(

        (a, b) =>

          Number(b.is_primary) - Number(a.is_primary) || Number(a.sort_order) - Number(b.sort_order)

      )

      const vs = product_variants.filter((v) => v.is_active)

      return {

        ...rest,

        collection_name: collections?.name ?? null,

        image: (imgs[0]?.image_url as string) ?? null,

        variant_count: vs.length,

        total_stock: vs.reduce((n, v) => n + Number(v.stock_quantity), 0)

      }

    }

  )

  return { total: count ?? 0, page, limit: size, products }

}



async function getProduct(db: DB, id: string) {

  const { data, error } = await db

    .from('products')

    .select('*, product_images(*), product_variants(*)')

    .eq('id', id)

    .maybeSingle()

  check(error)

  if (!data) throw new HttpError(404, 'Product not found')

  data.product_images.sort((a: Obj, b: Obj) => Number(a.sort_order) - Number(b.sort_order))

  data.product_variants.sort((a: Obj, b: Obj) =>

    String(a.size || '').localeCompare(String(b.size || ''))

  )

  return data

}



async function lowStock(db: DB, sp: URLSearchParams) {

  const threshold = Math.min(1000, Math.max(0, Number(sp.get('threshold') ?? 5) || 0))

  const { data, error } = await db

    .from('product_variants')

    .select('id,sku,size,colour,stock_quantity,products!inner(id,name,status,allow_backorder)')

    .eq('is_active', true)

    .neq('products.status', 'archived')

    .lte('stock_quantity', threshold)

    .order('stock_quantity')

    .limit(200)

  check(error)

  return { threshold, variants: data || [] }

}



const VIDEO_TYPES: Record<string, string> = {

  'video/mp4': 'mp4',

  'video/webm': 'webm',

  'video/quicktime': 'mov'

}



// Videos upload straight to storage via a signed URL (avoids buffering big files in the function)



async function signUpload(db: DB, b: Obj) {

  const ext = VIDEO_TYPES[String(b.content_type)]



  if (!ext) {

    throw new HttpError(400, 'Only MP4, WEBM or MOV videos are allowed')

  }



  const path = `catalog/${crypto.randomUUID()}.${ext}`



  const { data, error } = await db.storage

    .from(BUCKET)

    .createSignedUploadUrl(path)



  if (error) {

    console.error('Signed upload creation failed:', error)

    throw new HttpError(500, 'Could not start video upload')

  }



  return {

    path: data.path,

    token: data.token,

    url: db.storage.from(BUCKET).getPublicUrl(path).data.publicUrl

  }

}





/* ---------- image upload (multipart) ---------- */

async function uploadImage(db: DB, req: Request) {

  const form = await req.formData()

  const file = form.get('file')

  if (!(file instanceof File)) throw new HttpError(400, 'No file uploaded')

  const ext = IMG_TYPES[file.type]

  if (!ext) throw new HttpError(400, 'Only JPG, PNG, WEBP or GIF images are allowed')

  if (file.size > 5 * 1024 * 1024) throw new HttpError(400, 'Image must be 5MB or smaller')

  const path = `catalog/${crypto.randomUUID()}.${ext}`

  const { error } = await db.storage

    .from(BUCKET)

    .upload(path, file, { contentType: file.type, cacheControl: '31536000' })

  if (error) {

    console.error(error)

    throw new HttpError(500, 'Upload failed')

  }

  return { url: db.storage.from(BUCKET).getPublicUrl(path).data.publicUrl, path }

}




const actions = ['save_product','delete_product','set_status','adjust_stock','bulk_stock','save_collection','delete_collection','reorder_collections']
Deno.serve(handle(async (req, cors) => {
 requireMethod(req,'GET','POST')
 const {user,db,role}=await requireRole(req,READ)
 const ok=(body:unknown)=>reply(cors,body)
 const sp=new URL(req.url).searchParams
 const reviewer=['owner','admin'].includes(role)
 if(req.method==='GET') {
 switch(sp.get('resource')) {
 case 'collections': return ok(await listCollections(db))
 case 'products': return ok(await listProducts(db,sp))
 case 'product': return ok({product:await getProduct(db,uid(sp.get('id')))})
 case 'low_stock': return ok(await lowStock(db,sp))
 case 'approvals': {
 if(!WRITE.includes(role)) throw new HttpError(403,'Forbidden')
 let q=db.from('inventory_approval_requests').select('*').order('created_at',{ascending:false}).limit(200)
 if(!reviewer) q=q.eq('requested_by',user.id)
 const {data,error}=await q; check(error); return ok({requests:data})
 }
 case 'approval': {
 if(!WRITE.includes(role)) throw new HttpError(403,'Forbidden')
 let q=db.from('inventory_approval_requests').select('*,inventory_approval_history(*)').eq('id',uid(sp.get('id')))
 if(!reviewer) q=q.eq('requested_by',user.id)
 const {data,error}=await q.maybeSingle(); check(error); if(!data) throw new HttpError(404,'Not found'); return ok({request:data})
 }
 default: throw new HttpError(400,'Unknown resource')
 }}
 if(!WRITE.includes(role)) throw new HttpError(403,'Forbidden')
 if((req.headers.get('content-type')||'').includes('multipart/form-data')) return ok(await uploadImage(db,req))
 const b=await readJson(req)
 if(b.action==='sign_upload') return ok(await signUpload(db,b))
 const decision=['approve_request','reject_request','suspend_request','resume_request','cancel_request'].includes(String(b.action))
 if(!decision&&!actions.includes(String(b.action))) throw new HttpError(400,'Unknown action')
 const {data,error}=await db.rpc('inventory_workflow',{p_actor:user.id,p_action:b.action,p_payload:b})
 if(error) { console.error(error); throw new HttpError(error.code==='42501'?403:409,error.message) }
 return ok(data)
}))
