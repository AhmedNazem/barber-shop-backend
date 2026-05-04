import { Request, Response, NextFunction } from 'express'
import { ok, paginated } from '@/lib/response'
import { createShop, updateShop, setShopImage, getShopStatus, getShop } from '@/services/shop.service'
import { listShops } from '@/services/shop.list.service'
import { getShopPlan, updateShopPlan, updateBookingMode } from '@/services/plan.service'
import { uploadToS3 } from '@/lib/s3'
import { ShopPlan, BookingMode } from '@prisma/client'
import { PriceRange } from '@prisma/client'

export async function createShopHandler(req: Request, res: Response, next: NextFunction) {
  try {
    const result = await createShop(req.user!.id, req.body)
    res.status(201).json({ data: result })
  } catch (err) {
    next(err)
  }
}

export async function updateShopHandler(req: Request, res: Response, next: NextFunction) {
  try {
    const result = await updateShop(req.params['id']!, req.user!.id, req.body)
    ok(res, result)
  } catch (err) {
    next(err)
  }
}

export function uploadImageHandler(field: 'coverUrl' | 'logoUrl') {
  return async (req: Request, res: Response, next: NextFunction) => {
    try {
      const shopId = req.params['id']!
      const file = req.file!
      const ext = field === 'coverUrl' ? 'cover' : 'logo'
      const url = await uploadToS3(`shops/${shopId}/${ext}`, file.buffer, file.mimetype)
      const result = await setShopImage(shopId, req.user!.id, field, url)
      ok(res, { url: result[field] })
    } catch (err) {
      next(err)
    }
  }
}

export async function getShopStatusHandler(req: Request, res: Response, next: NextFunction) {
  try {
    const result = await getShopStatus(req.user!.id)
    ok(res, result)
  } catch (err) {
    next(err)
  }
}

export async function listShopsHandler(req: Request, res: Response, next: NextFunction) {
  try {
    const q = req.query as Record<string, string>
    const result = await listShops({
      search: q['search'],
      service: q['service'],
      city: q['city'],
      priceRange: q['priceRange'] as PriceRange | undefined,
      minRating: q['minRating'] ? Number(q['minRating']) : undefined,
      lat: q['lat'] ? Number(q['lat']) : undefined,
      lng: q['lng'] ? Number(q['lng']) : undefined,
      limit: q['limit'] ? Math.min(Number(q['limit']), 50) : 20,
      offset: q['offset'] ? Number(q['offset']) : 0,
    })
    paginated(res, result.shops, { total: result.total, limit: result.limit, offset: result.offset })
  } catch (err) {
    next(err)
  }
}

export async function getShopHandler(req: Request, res: Response, next: NextFunction) {
  try {
    const result = await getShop(req.params['id']!)
    ok(res, result)
  } catch (err) {
    next(err)
  }
}

export async function getShopPlanHandler(req: Request, res: Response, next: NextFunction) {
  try {
    ok(res, await getShopPlan(req.params['id']!))
  } catch (err) { next(err) }
}

export async function updateShopPlanHandler(req: Request, res: Response, next: NextFunction) {
  try {
    await updateShopPlan(req.params['id']!, req.body.plan as ShopPlan, req.body.expiresAt)
    ok(res, { ok: true })
  } catch (err) { next(err) }
}

export async function updateBookingModeHandler(req: Request, res: Response, next: NextFunction) {
  try {
    await updateBookingMode(req.params['id']!, req.user!.id, req.body.mode as BookingMode)
    ok(res, { ok: true })
  } catch (err) { next(err) }
}
