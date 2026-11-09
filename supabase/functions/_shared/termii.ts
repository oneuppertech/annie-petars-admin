export function ngPhone(p?: string | null) {
  const d = (p || '').replace(/\D/g, '')
  if (d.startsWith('234')) return d
  if (d.startsWith('0')) return '234' + d.slice(1)
  return d.length >= 10 ? d : ''
}
export async function sendSms(to: string | null | undefined, sms: string) {
  const phone = ngPhone(to)
  if (!phone) return
  try {
    const r = await fetch('https://api.ng.termii.com/api/sms/send', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        to: phone,
        from: Deno.env.get('TERMII_SENDER_ID'),
        sms,
        type: 'plain',
        channel: 'generic',
        api_key: Deno.env.get('TERMII_API_KEY')
      })
    })
    if (!r.ok) console.error('termii', r.status, await r.text())
  } catch (e) {
    console.error('termii', e)
  } // notifications must never break payment flow
}
