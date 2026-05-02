import { Request, Response, NextFunction } from 'express'
import { randomUUID } from 'crypto'
import { ok } from '@/lib/response'
import { uploadToS3 } from '@/lib/s3'
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
    const files = (req.files ?? []) as Express.Multer.File[]
    const photoUrls = await Promise.all(
      files.map(f => {
        const ext = f.mimetype.split('/')[1]
        const key = `reviews/${randomUUID()}.${ext}`
        return uploadToS3(key, f.buffer, f.mimetype)
      }),
    )
    const result = await createReview(req.user!.id, { ...req.body, photoUrls })
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
