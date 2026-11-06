import { handle, reply, requireMethod } from '../_shared/http.ts'
import { getAdminClient } from '../_shared/supabaseAdmin.ts'
Deno.serve(handle(async(req,cors)=>{
 requireMethod(req,'GET')
 const url=new URL(req.url)
 const db=getAdminClient()
 const {data,error}=await db.rpc('get_public_catalog',{
  p_collection_slug:url.searchParams.get('collection')||null,
  p_search:url.searchParams.get('q')||null,
  p_featured_only:url.searchParams.get('featured')==='true',
  p_limit:Math.min(Number(url.searchParams.get('limit')||24),100),
  p_offset:Math.max(Number(url.searchParams.get('offset')||0),0)
 })
 if(error) throw error
 return reply(cors,data)
}))
