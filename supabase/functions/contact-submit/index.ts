import { handle, reply, readJson, requireMethod, email, text, HttpError } from '../_shared/http.ts'
import { getAdminClient } from '../_shared/supabaseAdmin.ts'
Deno.serve(handle(async(req,cors)=>{
 requireMethod(req,'POST'); const b=await readJson(req)
 const name=text(b.name,120), message=text(b.message,5000), e=email(b.email)
 if(!name||!message) throw new HttpError(400,'Name and message are required')
 const {error}=await getAdminClient().from('contact_messages').insert({name,email:e,message,enquiry_type:text(b.type,100)||'General enquiry'})
 if(error) throw new HttpError(500,'Could not submit enquiry')
 return reply(cors,{success:true,message:'Your enquiry has been received.'},201)
}))
