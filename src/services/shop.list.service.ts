import { PriceRange } from '@prisma/client'
import { prisma } from '@/config/prisma'
import { redisClient } from '@/lib/redis'
import { isShopOpen } from '@/lib/shop-hours'
import { haversineMeters } from '@/lib/geo'

const RATING_TTL = 300

export type ListShopsFilters = {
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

  const shopIds = shops.map(s => s.id)

  // Redis queue-count cache (TTL: 60s) — avoids groupBy on warm requests
  const queueKeys = shopIds.map(id => `shop:queue:${id}`)
  const cachedQ   = await redisClient.mget(...queueKeys)
  const queueMap  = new Map<string, number>()
  const missIds: string[] = []

  cachedQ.forEach((val, i) => {
    if (val !== null) queueMap.set(shopIds[i]!, parseInt(val, 10))
    else              missIds.push(shopIds[i]!)
  })

  if (missIds.length > 0) {
    const queueGroups = await prisma.queueEntry.groupBy({
      by:    ['shopId'],
      where: { shopId: { in: missIds }, status: { in: ['WAITING', 'IN_CHAIR'] } },
      _count: { id: true },
    })
    const pipeline = redisClient.pipeline()
    missIds.forEach(id => {
      const count = queueGroups.find(q => q.shopId === id)?._count.id ?? 0
      queueMap.set(id, count)
      pipeline.setex(`shop:queue:${id}`, 60, count.toString())
    })
    await pipeline.exec()
  }

  const ratingKeys = shopIds.map(id => `shop:rating:${id}`)
  const cachedRatings = await redisClient.mget(...ratingKeys)
  const now = new Date()

  const result = await Promise.all(
    shops.map(async (shop, i) => {
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

      const queueCount = queueMap.get(shop.id) ?? 0
      const barberCount = shop._count.barbers
      const ratio = barberCount > 0 ? queueCount / barberCount : 0
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
        distanceMeters: lat != null && lng != null ? haversineMeters(lat, lng, shop.lat, shop.lng) : null,
      }
    }),
  )

  const filtered = minRating != null ? result.filter(s => s.avgRating != null && s.avgRating >= minRating) : result
  return { shops: filtered, total, limit, offset }
}

export async function getFeaturedShops(limit: number) {
  const { shops } = await listShops({ limit: 50, offset: 0 })
  return [...shops].sort((a, b) => (b.avgRating ?? 0) - (a.avgRating ?? 0)).slice(0, limit)
}
