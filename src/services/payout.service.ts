import { prisma } from '@/config/prisma'

export async function getAdminPayouts(year: number, month: number) {
  const from = new Date(year, month - 1, 1)
  const to   = new Date(year, month, 1)

  const groups = await prisma.booking.groupBy({
    by:      ['shopId'],
    where:   { status: 'COMPLETED', slot: { gte: from, lt: to } },
    _sum:    { totalPrice: true, platformFee: true, shopPayout: true },
    _count:  { _all: true },
    orderBy: { _sum: { platformFee: 'desc' } },
    take:    50,
  })

  if (!groups.length) return []

  const shops = await prisma.shop.findMany({
    where:  { id: { in: groups.map((g) => g.shopId) } },
    select: { id: true, nameEn: true, nameAr: true },
  })
  const shopMap = new Map(shops.map((s) => [s.id, s]))

  return groups.map((g) => ({
    shopId:      g.shopId,
    shopNameEn:  shopMap.get(g.shopId)?.nameEn ?? '—',
    shopNameAr:  shopMap.get(g.shopId)?.nameAr ?? '—',
    bookings:    g._count._all,
    grossRevenue: g._sum.totalPrice  ?? 0,
    platformFee:  g._sum.platformFee ?? 0,
    shopPayout:   g._sum.shopPayout  ?? 0,
  }))
}

export async function getShopPayout(shopId: string, year: number, month: number) {
  const from = new Date(year, month - 1, 1)
  const to   = new Date(year, month, 1)

  const [bookings, config] = await Promise.all([
    prisma.booking.findMany({
      where:   { shopId, status: 'COMPLETED', slot: { gte: from, lt: to } },
      select:  { id: true, refCode: true, slot: true, totalPrice: true, platformFee: true, shopPayout: true, barberName: true },
      orderBy: { slot: 'asc' },
      take:    200,
    }),
    prisma.platformConfig.findUnique({ where: { id: 'singleton' }, select: { commissionPercent: true } }),
  ])

  const grossRevenue = bookings.reduce((s, b) => s + b.totalPrice, 0)
  const platformFee  = bookings.reduce((s, b) => s + b.platformFee, 0)
  const shopPayout   = bookings.reduce((s, b) => s + b.shopPayout, 0)

  return {
    year,
    month,
    commissionPct: config?.commissionPercent ?? 10,
    grossRevenue,
    platformFee,
    shopPayout,
    bookings,
  }
}
