import { prisma } from '@/config/prisma'

export async function getAdminKpis() {
  const now        = new Date()
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1)

  const [allTimeRev, monthRev, totalBookings, activeShops, registeredUsers] = await Promise.all([
    prisma.booking.aggregate({ where: { status: 'COMPLETED' }, _sum: { totalPrice: true } }),
    prisma.booking.aggregate({
      where: { status: 'COMPLETED', slot: { gte: monthStart } },
      _sum:  { totalPrice: true },
    }),
    prisma.booking.count(),
    prisma.shop.count({ where: { status: 'APPROVED' } }),
    prisma.user.count({ where: { deletedAt: null } }),
  ])

  return {
    revenueAllTime:   allTimeRev._sum.totalPrice ?? 0,
    revenueThisMonth: monthRev._sum.totalPrice   ?? 0,
    totalBookings,
    activeShops,
    registeredUsers,
  }
}

export async function getAdminRevenue() {
  const now        = new Date()
  const rangeStart = new Date(now.getFullYear(), now.getMonth() - 11, 1)

  const completed = await prisma.booking.findMany({
    where:  { status: 'COMPLETED', slot: { gte: rangeStart } },
    select: { slot: true, totalPrice: true },
  })

  const monthMap = new Map<string, number>()
  for (const { slot, totalPrice } of completed) {
    const local = new Date(slot.getTime() + 3 * 3_600_000) // UTC+3 Baghdad
    const key   = `${local.getUTCFullYear()}-${String(local.getUTCMonth() + 1).padStart(2, '0')}`
    monthMap.set(key, (monthMap.get(key) ?? 0) + totalPrice)
  }

  return Array.from({ length: 12 }, (_, i) => {
    const d   = new Date(now.getFullYear(), now.getMonth() - 11 + i, 1)
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
    const gross = monthMap.get(key) ?? 0
    return { month: key, gross, commission: Math.round(gross * 0.10) }
  })
}

export async function getAdminTopShops(limit: number) {
  const groups = await prisma.booking.groupBy({
    by:      ['shopId'],
    where:   { status: 'COMPLETED' },
    _sum:    { totalPrice: true },
    _count:  { _all: true },
    orderBy: { _sum: { totalPrice: 'desc' } },
    take:    limit,
  })

  if (!groups.length) return []

  const shops = await prisma.shop.findMany({
    where:  { id: { in: groups.map((g) => g.shopId) } },
    select: { id: true, nameEn: true, city: true },
  })
  const shopMap = new Map(shops.map((s) => [s.id, s]))

  return groups.map((g) => ({
    id:       g.shopId,
    name:     shopMap.get(g.shopId)?.nameEn ?? '—',
    city:     shopMap.get(g.shopId)?.city   ?? '—',
    revenue:  g._sum.totalPrice ?? 0,
    bookings: g._count._all,
  }))
}

export async function getAdminPeakHours() {
  const completed = await prisma.booking.findMany({
    where:  { status: 'COMPLETED' },
    select: { slot: true },
  })

  const cellMap = new Map<string, number>()
  for (const { slot } of completed) {
    const local = new Date(slot.getTime() + 3 * 3_600_000) // UTC+3 Baghdad
    const key   = `${local.getUTCDay()}-${local.getUTCHours()}`
    cellMap.set(key, (cellMap.get(key) ?? 0) + 1)
  }

  return Array.from(cellMap.entries()).map(([k, count]) => {
    const [day, hour] = k.split('-').map(Number) as [number, number]
    return { day, hour, count }
  })
}
