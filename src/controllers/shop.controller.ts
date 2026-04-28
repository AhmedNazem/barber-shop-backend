import { Request, Response, NextFunction } from 'express'
import { ok } from '@/lib/response'
import { getShopStatus } from '@/services/shop.service'

export async function getShopStatusHandler(req: Request, res: Response, next: NextFunction) {
  try {
    const result = await getShopStatus(req.user!.id)
    ok(res, result)
  } catch (err) {
    next(err)
  }
}
