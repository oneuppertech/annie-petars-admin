import { handle, reply, requireMethod, HttpError } from '../_shared/http.ts'
import { requireRole } from '../_shared/supabaseAdmin.ts'
Deno.serve(handle(async(req,cors)=>{
 requireMethod(req,'GET')
 const {db}=await requireRole(req,['owner','admin','catalog_manager','order_manager','support'])
 const [orders,products,requests,messages,subscribers]=await Promise.all([
  db.from('orders').select('id,status,payment_status,total_kobo,placed_at',{count:'exact',head:true}),
  db.from('products').select('id,status',{count:'exact',head:true}),
  db.from('custom_requests').select('id,status',{count:'exact',head:true}),
  db.from('contact_messages').select('id,status',{count:'exact',head:true}),
  db.from('newsletter_subscribers').select('id',{count:'exact',head:true}).eq('status','subscribed')
 ])
 const errs=[orders,products,requests,messages,subscribers].filter(x=>x.error)
 if(errs.length) throw new HttpError(500,'Could not load dashboard')
 const {data:recentOrders}=await db.from('orders').select('id,order_number,email,status,payment_status,total_kobo,currency,placed_at').order('placed_at',{ascending:false}).limit(8)
 const {data:recentRequests}=await db.from('custom_requests').select('id,request_number,name,email,outfit_type,status,created_at').order('created_at',{ascending:false}).limit(8)
 return reply(cors,{counts:{orders:orders.count||0,products:products.count||0,custom_requests:requests.count||0,contact_messages:messages.count||0,subscribers:subscribers.count||0},recent_orders:recentOrders||[],recent_custom_requests:recentRequests||[]})
}))
