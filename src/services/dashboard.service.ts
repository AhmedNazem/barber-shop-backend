import { prisma } from '@/config/prisma'
import { AppError } from '@/lib/errors'

function todayRange() {
  const start = new Date()
  start.setHours(0, 0, 0, 0)
  const end = new Date()
  end.setHours(23, 59, 59, 999)
  return { start, end }
}

function resolveRange(range: string, startStr?: string, endStr?: string) {
  const now = new Date()
  if (range === 'today') {
    const s = new Date(now); s.setHours(0, 0, 0, 0)
    const e = new Date(now); e.setHours(23, 59, 59, 999)
    return { start: s, end: e }
  }
  if (range === 'week') {
    const s = new Date(now); s.setDate(s.getDate() - 6); s.setHours(0, 0, 0, 0)
    return { start: s, end: now }
  }
  if (range === 'month') {
    const s = new Date(now); s.setDate(s.getDate() - 29); s.setHours(0, 0, 0, 0)
    return { start: s, end: now }
  }
  // custom
  const start = startStr ? new Date(startStr) : new Date(now.setDate(now.getDate() - 29))
  const end   = endStr   ? new Date(endStr)   : new Date()
  return { start, end }
}

async function resolveBarberScope(userId: string, shopId: string): Promise<string | undefined> {
  const barber = await prisma.barber.findFirst({ where: { userId, shopId } })
  return barber?.id
}

export async function getBarberAnalytics(shopId: string | undefined) {
  if (!shopId) throw new AppError('not_found', 404)

  const barbers = await prisma.barber.findMany({
    where: { shopId, isActive: true },
    select: { id: true, nameEn: true, nameAr: true },
  })

  const [bookingRows, reviewRows] = await Promise.all([
    prisma.booking.groupBy({
      by:     ['barberId'],
      where:  { shopId, barberId: { not: null } },
      _count: { id: true },
      _sum:   { totalPrice: true },
    }),
    prisma.review.groupBy({
      by:    ['barberId'],
      where: { shopId, barberId: { not: null } },
      _avg:  { rating: true },
    }),
  ])

  const bookingMap = new Map(bookingRows.map(r => [r.barberId!, { count: r._count.id, revenue: r._sum.totalPrice ?? 0 }]))
  const reviewMap  = new Map(reviewRows.map(r => [r.barberId!, r._avg.rating ?? 0]))

  return barbers.map(b => ({
    barberId:      b.id,
    nameEn:        b.nameEn,
    nameAr:        b.nameAr,
    totalBookings: bookingMap.get(b.id)?.count   ?? 0,
    totalRevenue:  bookingMap.get(b.id)?.revenue ?? 0,
    avgRating:     Number((reviewMap.get(b.id) ?? 0).toFixed(1)),
  }))
}

export async function getDashboardAnalytics(
  userId: string, role: string, shopId: string | undefined,
  range: string, startStr?: string, endStr?: string,
) {
  if (!shopId) throw new AppError('not_found', 404)

  const { start, end } = resolveRange(range, startStr, endStr)
  const barberId = role === 'BARBER' ? await resolveBarberScope(userId, shopId) : undefined

  const bookings = await prisma.booking.findMany({
    where: {
      shopId,
      slot: { gte: start, lte: end },
      ...(barberId ? { barberId } : {}),
    },
    select: { status: true, totalPrice: true, slot: true },
  })

  const totalBookings     = bookings.length
  const completedBookings = bookings.filter(b => b.status === 'COMPLETED').length
  const cancelledBookings = bookings.filter(b => b.status === 'CANCELLED').length
  const noShowBookings    = bookings.filter(b => b.status === 'NO_SHOW').length
  const totalRevenue      = bookings
    .filter(b => b.status === 'COMPLETED')
    .reduce((s, b) => s + b.totalPrice, 0)

  // Group by date (YYYY-MM-DD) for daily chart
  const dayMap = new Map<string, { revenue: number; bookings: number }>()
  for (const b of bookings) {
    const day = b.slot.toISOString().slice(0, 10)
    const cur = dayMap.get(day) ?? { revenue: 0, bookings: 0 }
    cur.bookings++
    if (b.status === 'COMPLETED') cur.revenue += b.totalPrice
    dayMap.set(day, cur)
  }
  const dailyRevenue = Array.from(dayMap.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, d]) => ({ date, revenue: d.revenue, bookings: d.bookings }))

  return { totalRevenue, totalBookings, completedBookings, cancelledBookings, noShowBookings, dailyRevenue }
}

export async function getDashboardActivity(userId: string) {
  return prisma.notification.findMany({
    where:   { userId },
    orderBy: { createdAt: 'desc' },
    take:    10,
  })
}

export async function getDashboardStats(userId: string, role: string, shopId: string | undefined) {
  if (!shopId) throw new AppError('not_found', 404)

  const { start, end } = todayRange()
  const barberId = role === 'BARBER' ? await resolveBarberScope(userId, shopId) : undefined

  const bookingWhere = {
    shopId,
    slot: { gte: start, lte: end },
    ...(barberId ? { barberId } : {}),
  }

  const [todayBookings, revenueAgg, queueEntries] = await Promise.all([
    prisma.booking.count({ where: bookingWhere }),
    prisma.booking.aggregate({
      where:  { ...bookingWhere, status: 'COMPLETED' },
      _sum:   { totalPrice: true },
    }),
    prisma.queueEntry.findMany({
      where: {
        shopId,
        status: 'WAITING',
        ...(barberId ? { barberId } : {}),
      },
      select: { estimatedWait: true },
    }),
  ])

  const queueLength = queueEntries.length
  const avgWaitMin  = queueLength > 0
    ? Math.round(queueEntries.reduce((s, e) => s + e.estimatedWait, 0) / queueLength)
    : 0

  return {
    todayBookings,
    todayRevenue: revenueAgg._sum.totalPrice ?? 0,
    queueLength,
    avgWaitMin,
  }
}
