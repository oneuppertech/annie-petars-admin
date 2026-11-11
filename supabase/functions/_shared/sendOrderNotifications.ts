
import {
  type OrderEvent,
  type OrderEmailData,
  orderSubject,
  orderTemplateVars
} from './orderEmails.ts'

import { sendTemplateEmail } from './termii.ts'

const TEMPLATE_KEYS: Record<OrderEvent, string> = {
  placed: 'TERMII_TPL_PLACED',
  shipped: 'TERMII_TPL_SHIPPED',
  delivered: 'TERMII_TPL_DELIVERED',
  cancelled: 'TERMII_TPL_CANCELLED',
  returned: 'TERMII_TPL_RETURNED'
}

export async function sendOrderEmail(
  email: string,
  event: OrderEvent,
  data: OrderEmailData
) {
  if (!email?.trim()) {
    throw new Error('Customer email address is missing')
  }

  const templateId = Deno.env.get(TEMPLATE_KEYS[event])

  if (!templateId) {
    throw new Error(
      `Termii template is not configured for ${event}`
    )
  }

  const result = await sendTemplateEmail(
    email.trim(),
    templateId,
    orderSubject(event, data),
    orderTemplateVars(event, data)
  )

  if (!result.ok) {
    throw new Error(result.error || `Failed to send ${event} email`)
  }

  console.log('Order email successfully sent:', {
    event,
    orderNumber: data.orderNumber,
    recipient: email,
    messageId: result.id
  })

  return result
}
