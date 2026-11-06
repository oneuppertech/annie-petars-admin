import { handle, reply, readJson, requireMethod, email, text, HttpError } from '../_shared/http.ts'
import { getAdminClient } from '../_shared/supabaseAdmin.ts'
Deno.serve(handle(async(req,cors)=>{
 requireMethod(req,'POST'); const b=await readJson(req); const e=email(b.email)
 const db=getAdminClient()
 const {data,error}=await db.from('newsletter_subscribers').upsert({email:e,status:'subscribed',source:text(b.source,80)||'website',unsubscribed_at:null},{onConflict:'email'}).select('id,email,status').single()
 if(error) throw new HttpError(400,'Could not subscribe')
 return reply(cors,{success:true,subscriber:data},201)
}))
