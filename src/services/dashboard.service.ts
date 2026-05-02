import { prisma } from '@/config/prisma'
import { AppError } from '@/lib/errors'

function todayRange() {
  const start = new Date()
  start.setHours(0, 0, 0, 0)
  const end = new Date()
  end.setHours(23, 59, 59, 999)
  return { start, end }
}

async function resolveBarberScope(userId: string, shopId: string): Promise<string | undefined> {
  const barber = await prisma.barber.findFirst({ where: { userId, shopId } })
  return barber?.id
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
