import { Request, Response, NextFunction } from 'express'
import { ok } from '@/lib/response'
import { getNotifications, markNotificationRead, markAllRead } from '@/services/notification.service'

export async function getNotificationsHandler(req: Request, res: Response, next: NextFunction) {
  try {
    ok(res, await getNotifications(req.user!.id))
  } catch (err) { next(err) }
}

export async function markReadHandler(req: Request, res: Response, next: NextFunction) {
  try {
    await markNotificationRead(req.params['id']!, req.user!.id)
    ok(res, { ok: true })
  } catch (err) { next(err) }
}

export async function markAllReadHandler(req: Request, res: Response, next: NextFunction) {
  try {
    await markAllRead(req.user!.id)
    ok(res, { ok: true })
  } catch (err) { next(err) }
}
