import { Request, Response, NextFunction } from 'express'
import { ok, paginated } from '@/lib/response'
import { createShop, updateShop, setShopImage, getShopStatus, getShop } from '@/services/shop.service'
import { listShops, getFeaturedShops } from '@/services/shop.list.service'
import { getShopPlan, updateShopPlan, updateBookingMode } from '@/services/plan.service'
import { getDiscount, createDiscount, deleteDiscount } from '@/services/discount.service'
import { uploadImageVariants } from '@/lib/s3'
import { ShopPlan, BookingMode } from '@prisma/client'
import { PriceRange } from '@prisma/client'
import { auditLog } from '@/lib/audit'

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
      const url = await uploadImageVariants(`shops/${shopId}/${ext}`, file.buffer)
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

export async function getFeaturedShopsHandler(req: Request, res: Response, next: NextFunction) {
  try {
    const limit = Math.min(Math.max(1, Number(req.query['limit']) || 4), 10)
    ok(res, await getFeaturedShops(limit))
  } catch (err) { next(err) }
}

export async function listShopsHandler(req: Request, res: Response, next: NextFunction) {
  try {
    const q = req.query as {
      search?: string; service?: string; city?: string; priceRange?: PriceRange;
      minRating?: number; lat?: number; lng?: number; limit?: number; offset?: number;
    }
    const result = await listShops({
      search: q.search,
      service: q.service,
      city: q.city,
      priceRange: q.priceRange,
      minRating: q.minRating,
      lat: q.lat,
      lng: q.lng,
      limit: q.limit ?? 20,
      offset: q.offset ?? 0,
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
    auditLog({ adminId: req.user!.id, action: 'shop.plan_update', targetId: req.params['id']!, targetType: 'shop', detail: { plan: req.body.plan, expiresAt: req.body.expiresAt } })
    ok(res, { ok: true })
  } catch (err) { next(err) }
}

export async function updateBookingModeHandler(req: Request, res: Response, next: NextFunction) {
  try {
    await updateBookingMode(req.params['id']!, req.user!.id, req.body.mode as BookingMode)
    ok(res, { ok: true })
  } catch (err) { next(err) }
}

// ─── Discount ─────────────────────────────────────────────────────────────────

export async function getDiscountHandler(req: Request, res: Response, next: NextFunction) {
  try {
    ok(res, await getDiscount(req.params['id']!))
  } catch (err) { next(err) }
}

export async function createDiscountHandler(req: Request, res: Response, next: NextFunction) {
  try {
    ok(res, await createDiscount(req.params['id']!, req.user!.id, req.body))
  } catch (err) { next(err) }
}

export async function deleteDiscountHandler(req: Request, res: Response, next: NextFunction) {
  try {
    await deleteDiscount(req.params['id']!, req.user!.id)
    ok(res, { ok: true })
  } catch (err) { next(err) }
}
