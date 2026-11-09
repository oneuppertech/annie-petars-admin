import { HttpError } from './http.ts'
const ps = async (path: string, init: RequestInit = {}) => {
  const r = await fetch('https://api.paystack.co' + path, { ...init, headers: {
    Authorization: `Bearer ${Deno.env.get('PAYSTACK_SECRET_KEY')}`, 'Content-Type': 'application/json' } })
  const j = await r.json().catch(() => null)
  if (!r.ok || !j?.status) throw new HttpError(502, 'Payment provider error', j?.message)
  return j.data
}
export const initTx = (b: unknown) => ps('/transaction/initialize', { method: 'POST', body: JSON.stringify(b) })
export const verifyTx = (ref: string) => ps('/transaction/verify/' + encodeURIComponent(ref))

export async function validSignature(raw: string, sig: string | null) {
  if (!sig) return false
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(Deno.env.get('PAYSTACK_SECRET_KEY')!),
    { name: 'HMAC', hash: 'SHA-512' }, false, ['sign'])
  const mac = new Uint8Array(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(raw)))
  const hex = [...mac].map(b => b.toString(16).padStart(2, '0')).join('')
  if (hex.length !== sig.length) return false
  let d = 0; for (let i = 0; i < hex.length; i++) d |= hex.charCodeAt(i) ^ sig.charCodeAt(i)
  return d === 0
}