import webPush from 'web-push'
import { env } from '@/config/env'

if (env.VAPID_PUBLIC_KEY && env.VAPID_PRIVATE_KEY) {
  webPush.setVapidDetails(
    `mailto:${env.VAPID_EMAIL ?? 'admin@barberos.app'}`,
    env.VAPID_PUBLIC_KEY,
    env.VAPID_PRIVATE_KEY,
  )
}

type PushSub = { endpoint: string; p256dh: string; auth: string }
type PushPayload = { title: string; body: string; url?: string; icon?: string }

export async function sendPush(sub: PushSub, payload: PushPayload): Promise<'ok' | 'expired'> {
  if (!env.VAPID_PUBLIC_KEY) return 'ok'
  try {
    await webPush.sendNotification(
      { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
      JSON.stringify({ ...payload, icon: payload.icon ?? '/icon-192.svg', badge: '/icon-192.svg' }),
    )
    return 'ok'
  } catch (err: unknown) {
    const status = (err as { statusCode?: number }).statusCode
    if (status === 404 || status === 410) return 'expired'
    return 'ok'
  }
}
