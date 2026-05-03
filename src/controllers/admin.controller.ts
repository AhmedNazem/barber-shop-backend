import { Request, Response, NextFunction } from 'express'
import { ok } from '@/lib/response'
import { approveShop, rejectShop, suspendShop } from '@/services/admin.service'

export async function approveShopHandler(req: Request, res: Response, next: NextFunction) {
  try {
    await approveShop(req.params['id']!)
    ok(res, { ok: true })
  } catch (err) { next(err) }
}

export async function rejectShopHandler(req: Request, res: Response, next: NextFunction) {
  try {
    await rejectShop(req.params['id']!, req.body.reason, req.body.reasonAr)
    ok(res, { ok: true })
  } catch (err) { next(err) }
}

export async function suspendShopHandler(req: Request, res: Response, next: NextFunction) {
  try {
    await suspendShop(req.params['id']!, req.body.reason)
    ok(res, { ok: true })
  } catch (err) { next(err) }
}
