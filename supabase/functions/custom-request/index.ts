import { handle, reply, requireMethod, email, text, HttpError } from '../_shared/http.ts'
import { getAdminClient } from '../_shared/supabaseAdmin.ts'

const MAX_FILE_BYTES = 8 * 1024 * 1024
const MAX_FILES = 5
const ALLOWED_TYPES = new Set(['image/jpeg','image/png','image/webp','image/gif','application/pdf'])
Deno.serve(handle(async(req,cors)=>{
 requireMethod(req,'POST')
 const contentType=req.headers.get('content-type')||''
 let b:Record<string,unknown>={}
 let uploads:File[]=[]
 if(contentType.includes('multipart/form-data')) {
  const form=await req.formData()
  for(const key of ['name','email','phone','country','outfit','fabric','colour','needBy','notes','unit','garment','measurements','accurate','terms']) {
   const value=form.get(key)
   if(value!==null) b[key]=value
  }
  uploads=form.getAll('files').filter((v):v is File=>v instanceof File && v.size>0)
 } else if(contentType.includes('application/json')) {
  try { b=await req.json() as Record<string,unknown> } catch { throw new HttpError(400,'Invalid JSON body') }
 } else throw new HttpError(415,'Send JSON or multipart form data')
 const name=text(b.name,120), outfit=text(b.outfit,160), e=email(b.email)
 if(!name||!outfit) throw new HttpError(400,'Name and outfit type are required')
 const truthy=(v:unknown)=>v===true||v==='true'||v==='on'
 if(!truthy(b.accurate)||!truthy(b.terms)) throw new HttpError(400,'Both confirmations are required')
 if(uploads.length>MAX_FILES) throw new HttpError(400,`You can attach at most ${MAX_FILES} files`)
 for(const file of uploads) {
  if(file.size>MAX_FILE_BYTES) throw new HttpError(400,'Each file must be 8MB or smaller')
  if(!ALLOWED_TYPES.has(file.type)) throw new HttpError(400,'Only JPG, PNG, WEBP, GIF and PDF files are accepted')
 }
 const unit=b.unit==='in'?'in':'cm'
 let measurements:Record<string,unknown>={}
 if(typeof b.measurements==='string') { try { measurements=JSON.parse(b.measurements) } catch { throw new HttpError(400,'Measurements must be valid JSON') } }
 else if(b.measurements && typeof b.measurements==='object' && !Array.isArray(b.measurements)) measurements=b.measurements as Record<string,unknown>
 const db=getAdminClient()
 const {data:request,error}=await db.from('custom_requests').insert({
  name,email:e,phone:text(b.phone,40)||null,country:text(b.country,80)||null,outfit_type:outfit,
  garment_type:text(b.garment,40)||'dress',fabric_preference:text(b.fabric,160)||null,
  colour_preference:text(b.colour,120)||null,needed_by:text(b.needBy,20)||null,
  measurement_unit:unit,measurements,notes:text(b.notes,4000)||null,
  terms_accepted:true,accuracy_confirmed:true
 }).select('id,request_number,status,created_at').single()
 if(error) { console.error(error); throw new HttpError(500,'Could not submit custom request') }
 const uploaded=[]
 for(const file of uploads) {
  const safeName=file.name.replace(/[^a-zA-Z0-9._-]/g,'_').slice(-120)
  const path=`${request.id}/${crypto.randomUUID()}-${safeName}`
  const {error:uploadError}=await db.storage.from('custom-request-files').upload(path,file,{contentType:file.type,upsert:false})
  if(uploadError) {
   console.error(uploadError)
   // Keep the request, but report that attachments were not all saved.
   continue
  }
  const {error:recordError}=await db.from('custom_request_files').insert({
   request_id:request.id,storage_path:path,original_name:file.name.slice(0,255),
   content_type:file.type,size_bytes:file.size
  })
  if(recordError) console.error(recordError)
  else uploaded.push(path)
 }
 return reply(cors,{success:true,request,uploaded_files:uploaded.length,attachment_warning:uploaded.length<uploads.length? 'The request was saved, but one or more attachments could not be saved. Contact the shop if the files are important.':null,message:'Your request has been received. The team will review it.'},201)
}))
