import { prisma } from '@/config/prisma'
import { AppError } from '@/lib/errors'
import { redisClient } from '@/lib/redis'
import { isShopOpen } from '@/lib/shop-hours'

const RATING_TTL = 300

export async function getShopStatus(ownerId: string) {
  const shop = await prisma.shop.findFirst({ where: { ownerId } })
  if (!shop) throw new AppError('not_found', 404)

  return {
    status: shop.status,
    ...(shop.rejectionReason && { rejectionReason: shop.rejectionReason }),
  }
}

export async function getShop(shopId: string) {
  const shop = await prisma.shop.findUnique({
    where: { id: shopId },
    include: {
      hours: true,
      discount: true,
      services: {
        where: { isActive: true },
        include: { photos: { orderBy: { order: 'asc' } } },
        orderBy: { nameEn: 'asc' },
      },
      barbers: { where: { isActive: true }, orderBy: { nameEn: 'asc' } },
      _count: { select: { barbers: { where: { isActive: true } } } },
    },
  })

  if (!shop || shop.status !== 'APPROVED') throw new AppError('not_found', 404)

  const now = new Date()

  // Rating — Redis cache then DB fallback
  const cacheKey = `shop:rating:${shop.id}`
  const cached = await redisClient.get(cacheKey)
  let avgRating: number | null = null
  let reviewCount = 0
  if (cached) {
    const parsed = JSON.parse(cached)
    avgRating = parsed.avgRating
    reviewCount = parsed.reviewCount
  } else {
    const agg = await prisma.review.aggregate({
      where: { shopId: shop.id, isVisible: true },
      _avg: { rating: true },
      _count: { rating: true },
    })
    avgRating = agg._avg.rating
    reviewCount = agg._count.rating
    await redisClient.setex(cacheKey, RATING_TTL, JSON.stringify({ avgRating, reviewCount }))
  }

  // Load
  const queueCount = await prisma.queueEntry.count({
    where: { shopId: shop.id, status: { in: ['WAITING', 'IN_CHAIR'] } },
  })
  const ratio = shop._count.barbers > 0 ? queueCount / shop._count.barbers : 0
  const load: 'low' | 'medium' | 'high' = ratio < 0.5 ? 'low' : ratio < 1.5 ? 'medium' : 'high'

  const discount =
    shop.discount && shop.discount.expiresAt > now && shop.discount.slotsClaimed < shop.discount.maxUsers
      ? { pct: shop.discount.pct, expiresAt: shop.discount.expiresAt }
      : null

  return {
    id: shop.id, nameEn: shop.nameEn, nameAr: shop.nameAr,
    address: shop.address, city: shop.city,
    neighborhood: shop.neighborhood, neighborhoodAr: shop.neighborhoodAr,
    lat: shop.lat, lng: shop.lng, coverUrl: shop.coverUrl, logoUrl: shop.logoUrl,
    priceRange: shop.priceRange, plan: shop.plan,
    avgRating, reviewCount, isOpen: isShopOpen(shop.hours, now), load, discount,
    services: shop.services,
    barbers: shop.barbers,
  }
}
