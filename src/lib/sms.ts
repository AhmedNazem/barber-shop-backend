import { env } from '@/config/env'
import { logger } from '@/lib/logger'

export async function sendSms(phone: string, message: string): Promise<void> {
  if (env.NODE_ENV !== 'production' || !env.SMS_API_KEY) {
    logger.info(`[SMS DEV] To: ${phone} | ${message}`)
    return
  }

  if (env.SMS_PROVIDER === 'unifonic') {
    await sendUnifonic(phone, message)
  } else if (env.SMS_PROVIDER === 'twilio') {
    await sendTwilio(phone, message)
  } else {
    logger.warn('[SMS] No SMS provider configured — message not sent')
  }
}

async function sendUnifonic(phone: string, message: string): Promise<void> {
  const resp = await fetch('https://el.cloud.unifonic.com/rest/SMS/messages', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      AppSid: env.SMS_API_KEY!,
      SenderID: env.SMS_SENDER_ID ?? 'BarberOS',
      Body: message,
      Recipient: phone,
    }),
  })
  if (!resp.ok) {
    logger.error(`[SMS] Unifonic error ${resp.status}`)
  }
}

async function sendTwilio(phone: string, message: string): Promise<void> {
  // TODO: implement Twilio REST call when account credentials are available
  logger.warn(`[SMS] Twilio stub — message to ${phone} not sent`)
}
