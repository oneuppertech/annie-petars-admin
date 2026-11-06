import { getCorsHeaders } from './cors.ts'
export class HttpError extends Error { constructor(public status:number,message:string,public details?:unknown){super(message)} }
export function handle(fn:(req:Request,cors:Record<string,string>)=>Promise<Response>) {
 return async (req:Request) => {
  const cors=getCorsHeaders(req)
  if(req.method==='OPTIONS') return new Response('ok',{headers:cors})
  try { return await fn(req,cors) } catch(e) {
   if(e instanceof HttpError) return reply(cors,{error:e.message,details:e.details??null},e.status)
   console.error(e); return reply(cors,{error:'Internal server error'},500)
  }
 }
}
export function reply(cors:Record<string,string>,body:unknown,status=200,extra:Record<string,string>={}) {
 return new Response(JSON.stringify(body),{status,headers:{...cors,...extra,'Content-Type':'application/json'}})
}
export async function readJson(req:Request):Promise<Record<string,unknown>> {
 try { const x=await req.json(); if(!x||typeof x!=='object'||Array.isArray(x)) throw 0; return x as Record<string,unknown> }
 catch { throw new HttpError(400,'Invalid JSON body') }
}
export function requireMethod(req:Request,...methods:string[]) { if(!methods.includes(req.method)) throw new HttpError(405,'Method not allowed') }
export function text(v:unknown,max=2000) { if(typeof v!=='string') return ''; return v.trim().slice(0,max) }
export function email(v:unknown) { const e=text(v,254).toLowerCase(); if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e)) throw new HttpError(400,'A valid email is required'); return e }
