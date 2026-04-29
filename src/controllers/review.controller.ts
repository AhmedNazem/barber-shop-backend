import { Request, Response, NextFunction } from 'express'
import { ok } from '@/lib/response'
import { listShopReviews, createReview, flagReview, resolveFlag } from '@/services/review.service'

export async function listShopReviewsHandler(req: Request, res: Response, next: NextFunction) {
  try {
    const shopId  = req.params['id']!
    const asOwner = req.user?.role === 'SHOP_OWNER'
    const page    = Math.max(1, Number(req.query['page'])  || 1)
    const limit   = Math.min(50, Number(req.query['limit']) || 10)
    ok(res, await listShopReviews(shopId, asOwner, page, limit))
  } catch (err) { next(err) }
}

export async function createReviewHandler(req: Request, res: Response, next: NextFunction) {
  try {
    const result = await createReview(req.user!.id, req.body)
    res.status(201).json({ data: result })
  } catch (err) { next(err) }
}

export async function flagReviewHandler(req: Request, res: Response, next: NextFunction) {
  try {
    ok(res, await flagReview(req.params['reviewId']!, req.user!.id, req.body.reason))
  } catch (err) { next(err) }
}

export async function resolveFlagHandler(req: Request, res: Response, next: NextFunction) {
  try {
    ok(res, await resolveFlag(req.params['reviewId']!, req.body.action, req.body.removalReason))
  } catch (err) { next(err) }
}
