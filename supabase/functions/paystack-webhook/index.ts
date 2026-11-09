import { handle, reply, requireMethod, HttpError } from '../_shared/http.ts'
import { validSignature } from '../_shared/paystack.ts'
import { settle } from '../_shared/settle.ts'

Deno.serve(handle(async (req, cors) => {
  requireMethod(req, 'POST')
  const raw = await req.text()
  if (!(await validSignature(raw, req.headers.get('x-paystack-signature')))) throw new HttpError(401, 'Bad signature')
  const evt = JSON.parse(raw)
  if (evt.event === 'charge.success') await settle(evt.data)
  return reply(cors, { received: true }) // always 200 so Paystack stops retrying
}))