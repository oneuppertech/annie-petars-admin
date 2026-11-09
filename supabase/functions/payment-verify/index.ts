import { handle, reply, requireMethod, text, HttpError } from '../_shared/http.ts'
import { verifyTx } from '../_shared/paystack.ts'
import { settle } from '../_shared/settle.ts'

Deno.serve(handle(async (req, cors) => {
  requireMethod(req, 'GET')
  const ref = text(new URL(req.url).searchParams.get('reference'), 64)
  if (!ref) throw new HttpError(400, 'reference required')
  const tx = await verifyTx(ref)
  return reply(cors, { reference: ref, ...(await settle(tx)) })
}))