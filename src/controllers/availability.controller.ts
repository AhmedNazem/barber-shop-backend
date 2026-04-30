import { Request, Response, NextFunction } from 'express'
import { ok } from '@/lib/response'
import { getShopAvailability } from '@/services/availability.service'

export async function getShopAvailabilityHandler(req: Request, res: Response, next: NextFunction) {
  try {
    const shopId   = req.params['id']!
    const date     = req.query['date'] as string
    const barberId = req.query['barberId'] as string | undefined
    const isVip    = req.user?.isVip ?? false

    const slots = await getShopAvailability(shopId, date, barberId, isVip)
    ok(res, { slots })
  } catch (err) {
    next(err)
  }
}
