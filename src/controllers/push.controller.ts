import { Request, Response, NextFunction } from 'express'
import { ok } from '@/lib/response'
import { storePushSubscription, removePushSubscription } from '@/services/notification.service'

export async function subscribeHandler(req: Request, res: Response, next: NextFunction) {
  try {
    const { endpoint, keys } = req.body as {
      endpoint: string
      keys: { p256dh: string; auth: string }
    }
    await storePushSubscription(req.user!.id, endpoint, keys.p256dh, keys.auth)
    ok(res, { ok: true })
  } catch (err) { next(err) }
}

export async function unsubscribeHandler(req: Request, res: Response, next: NextFunction) {
  try {
    const { endpoint } = req.body as { endpoint: string }
    await removePushSubscription(endpoint)
    ok(res, { ok: true })
  } catch (err) { next(err) }
}
