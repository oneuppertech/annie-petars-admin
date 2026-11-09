import { getAdminClient } from './supabaseAdmin.ts'
import { HttpError } from './http.ts'

export async function settle(tx: {
  reference: string
  amount: number
  status: string
  currency?: string
}) {
  const db = getAdminClient()
  if (tx.status !== 'success') {
    await db
      .from('payments')
      .update({ status: 'failed', raw_response: tx })
      .eq('provider_reference', tx.reference)
      .neq('status', 'paid')
    return { paid: false, status: tx.status }
  }
  const { error } = await db.rpc('mark_order_paid', {
    p_reference: tx.reference,
    p_amount: tx.amount,
    p_raw: tx
  })
  if (error) throw new HttpError(409, error.message)
  return { paid: true, status: 'success' }
}