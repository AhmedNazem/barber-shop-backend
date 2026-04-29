import { PriceRange } from '@prisma/client'
import { prisma } from '@/config/prisma'
import { AppError } from '@/lib/errors'
import { redisClient } from '@/lib/redis'
import { isShopOpen } from '@/lib/shop-hours'
import { haversineMeters } from '@/lib/geo'

const RATING_TTL = 300 // 5 minutes

export async function getShopStatus(ownerId: string) {
  const shop = await prisma.shop.findFirst({ where: { ownerId } })
  if (!shop) throw new AppError('not_found', 404)

  return {
    status: shop.status,
    ...(shop.rejectionReason && { rejectionReason: shop.rejectionReason }),
  }
}

type ListShopsFilters = {
  search?: string
  service?: string
  minRating?: number
  priceRange?: PriceRange
  city?: string
  lat?: number
  lng?: number
  limit: number
  offset: number
}

export async function listShops(filters: ListShopsFilters) {
  const { search, service, minRating, priceRange, city, lat, lng, limit, offset } = filters

  const where = {
    status: 'APPROVED' as const,
    isActive: true,
    ...(city && { city }),
    ...(priceRange && { priceRange }),
    ...(search && {
      OR: [
        { nameEn: { contains: search, mode: 'insensitive' as const } },
        { nameAr: { contains: search } },
        { neighborhood: { contains: search, mode: 'insensitive' as const } },
      ],
    }),
    ...(service && {
      services: {
        some: {
          isActive: true,
          OR: [
            { nameEn: { contains: service, mode: 'insensitive' as const } },
            { nameAr: { contains: service } },
          ],
        },
      },
    }),
  }

  const [shops, total] = await Promise.all([
    prisma.shop.findMany({
      where,
      skip: offset,
      take: limit,
      include: {
        hours: true,
        discount: true,
        _count: { select: { barbers: { where: { isActive: true } } } },
      },
      orderBy: { createdAt: 'desc' },
    }),
    prisma.shop.count({ where }),
  ])

  if (shops.length === 0) return { shops: [], total, limit, offset }

  // Batch queue counts for load computation
  const shopIds = shops.map(s => s.id)
  const queueGroups = await prisma.queueEntry.groupBy({
    by: ['shopId'],
    where: { shopId: { in: shopIds }, status: { in: ['WAITING', 'IN_CHAIR'] } },
    _count: { id: true },
  })
  const queueMap = new Map(queueGroups.map(q => [q.shopId, q._count.id]))

  // Batch rating cache lookups
  const ratingKeys = shopIds.map(id => `shop:rating:${id}`)
  const cachedRatings = await redisClient.mget(...ratingKeys)

  const now = new Date()

  const result = await Promise.all(
    shops.map(async (shop, i) => {
      // Rating — Redis cache then DB fallback
      let avgRating: number | null = null
      let reviewCount = 0
      if (cachedRatings[i]) {
        const parsed = JSON.parse(cachedRatings[i]!)
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
        await redisClient.setex(ratingKeys[i]!, RATING_TTL, JSON.stringify({ avgRating, reviewCount }))
      }

      // Load
      const queueCount = queueMap.get(shop.id) ?? 0
      const barberCount = shop._count.barbers
      const ratio = barberCount > 0 ? queueCount / barberCount : 0
      const load: 'low' | 'medium' | 'high' = ratio < 0.5 ? 'low' : ratio < 1.5 ? 'medium' : 'high'

      // Discount (only active ones)
      const discount =
        shop.discount &&
        shop.discount.expiresAt > now &&
        shop.discount.slotsClaimed < shop.discount.maxUsers
          ? { pct: shop.discount.pct, expiresAt: shop.discount.expiresAt }
          : null

      return {
        id: shop.id,
        nameEn: shop.nameEn,
        nameAr: shop.nameAr,
        address: shop.address,
        city: shop.city,
        neighborhood: shop.neighborhood,
        neighborhoodAr: shop.neighborhoodAr,
        lat: shop.lat,
        lng: shop.lng,
        coverUrl: shop.coverUrl,
        logoUrl: shop.logoUrl,
        priceRange: shop.priceRange,
        plan: shop.plan,
        avgRating,
        reviewCount,
        isOpen: isShopOpen(shop.hours, now),
        load,
        discount,
        distanceMeters: lat != null && lng != null ? haversineMeters(lat, lng, shop.lat, shop.lng) : null,
      }
    }),
  )

  const filtered = minRating != null ? result.filter(s => s.avgRating != null && s.avgRating >= minRating) : result

  return { shops: filtered, total, limit, offset }
}
