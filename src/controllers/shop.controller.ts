import { Request, Response, NextFunction } from 'express'
import { ok, paginated } from '@/lib/response'
import { createShop, getShopStatus, getShop } from '@/services/shop.service'
import { listShops } from '@/services/shop.list.service'
import { PriceRange } from '@prisma/client'

export async function createShopHandler(req: Request, res: Response, next: NextFunction) {
  try {
    const result = await createShop(req.user!.id, req.body)
    res.status(201).json({ data: result })
  } catch (err) {
    next(err)
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
