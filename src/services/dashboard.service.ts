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

export async function getPeakHours(userId: string, role: string, shopId: string | undefined) {
  if (!shopId) throw new AppError('not_found', 404)

  const barberId = role === 'BARBER' ? await resolveBarberScope(userId, shopId) : undefined

  const [bookings, shopHours] = await Promise.all([
    prisma.booking.findMany({
      where: {
        shopId,
        status: { in: ['UPCOMING', 'CONFIRMED', 'COMPLETED'] },
        ...(barberId ? { barberId } : {}),
      },
      select: { slot: true },
    }),
    prisma.businessHours.findMany({
      where:   { shopId },
      orderBy: { dayOfWeek: 'asc' },
    }),
  ])

  // Build 7×24 count grid, keyed "day-hour"
  const countMap = new Map<string, number>()
  for (const b of bookings) {
    const day  = b.slot.getUTCDay()
    const hour = b.slot.getUTCHours()
    const key  = `${day}-${hour}`
    countMap.set(key, (countMap.get(key) ?? 0) + 1)
  }

  const cells = Array.from(countMap.entries()).map(([key, count]) => {
    const [day, hour] = key.split('-').map(Number)
    return { day, hour, count }
  })

  return { cells, shopHours }
}

export async function getTopServices(userId: string, role: string, shopId: string | undefined) {
  if (!shopId) throw new AppError('not_found', 404)

  const barberId = role === 'BARBER' ? await resolveBarberScope(userId, shopId) : undefined

  const bookings = await prisma.booking.findMany({
    where: {
      shopId,
      status: { in: ['UPCOMING', 'CONFIRMED', 'COMPLETED'] },
      ...(barberId ? { barberId } : {}),
    },
    select: {
      status: true,
      services: { select: { serviceId: true, nameEn: true, nameAr: true, price: true } },
    },
  })

  const map = new Map<string, { nameEn: string; nameAr: string; bookings: number; revenue: number }>()

  for (const booking of bookings) {
    for (const svc of booking.services) {
      const cur = map.get(svc.serviceId) ?? { nameEn: svc.nameEn, nameAr: svc.nameAr, bookings: 0, revenue: 0 }
      cur.bookings++
      if (booking.status === 'COMPLETED') cur.revenue += svc.price
      map.set(svc.serviceId, cur)
    }
  }

  return Array.from(map.entries())
    .map(([serviceId, d]) => ({ serviceId, ...d }))
    .sort((a, b) => b.bookings - a.bookings)
    .slice(0, 10)
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

  // Group by date (YYYY-MM-DD) for daily charts
  const dayRevMap = new Map<string, { revenue: number; bookings: number }>()
  const dayVolMap = new Map<string, { completed: number; cancelled: number; noShow: number }>()
  for (const b of bookings) {
    const day  = b.slot.toISOString().slice(0, 10)
    const rev  = dayRevMap.get(day) ?? { revenue: 0, bookings: 0 }
    const vol  = dayVolMap.get(day) ?? { completed: 0, cancelled: 0, noShow: 0 }
    rev.bookings++
    if (b.status === 'COMPLETED') { rev.revenue += b.totalPrice; vol.completed++ }
    if (b.status === 'CANCELLED') vol.cancelled++
    if (b.status === 'NO_SHOW')   vol.noShow++
    dayRevMap.set(day, rev)
    dayVolMap.set(day, vol)
  }
  const sort = (a: [string, unknown], b: [string, unknown]) => (a[0] as string).localeCompare(b[0] as string)
  const dailyRevenue = Array.from(dayRevMap.entries()).sort(sort).map(([date, d]) => ({ date, revenue: d.revenue, bookings: d.bookings }))
  const dailyVolume  = Array.from(dayVolMap.entries()).sort(sort).map(([date, d]) => ({ date, ...d }))

  return { totalRevenue, totalBookings, completedBookings, cancelledBookings, noShowBookings, dailyRevenue, dailyVolume }
}

export async function getDashboardActivity(_userId: string, shopId: string | undefined) {
  if (!shopId) throw new AppError('not_found', 404)

  const bookings = await prisma.booking.findMany({
    where:   { shopId },
    orderBy: { createdAt: 'desc' },
    take:    10,
    include: { services: { select: { nameEn: true, nameAr: true }, take: 1 } },
  })

  const customerIds = [...new Set(bookings.map(b => b.customerId))]
  const customers = customerIds.length > 0
    ? await prisma.user.findMany({ where: { id: { in: customerIds } }, select: { id: true, name: true } })
    : []
  const nameMap = new Map(customers.map(c => [c.id, c.name]))
  const now = Date.now()

  return bookings.map(b => {
    const name      = nameMap.get(b.customerId) ?? 'Customer'
    const svc       = b.services[0]?.nameEn ?? 'Service'
    const svcAr     = b.services[0]?.nameAr ?? 'خدمة'
    const timeAgo   = Math.floor((now - b.createdAt.getTime()) / 60000)

    if (b.status === 'CANCELLED') {
      return { id: b.id, type: 'cancellation', message: `${name} cancelled their booking`, messageAr: `${name} ألغى حجزه`, timeAgo }
    }
    if (b.paymentStatus === 'PAID') {
      return { id: b.id, type: 'payment', message: `${name} paid ${b.totalPrice.toLocaleString()} IQD`, messageAr: `${name} دفع ${b.totalPrice.toLocaleString()} د.ع`, timeAgo }
    }
    return { id: b.id, type: 'booking', message: `${name} booked ${svc}`, messageAr: `${name} حجز ${svcAr}`, timeAgo }
  })
}

export async function getDashboardUpcoming(shopId: string | undefined, limit = 5) {
  if (!shopId) throw new AppError('not_found', 404)

  const bookings = await prisma.booking.findMany({
    where:   { shopId, slot: { gte: new Date() }, status: { in: ['UPCOMING', 'CONFIRMED'] } },
    orderBy: { slot: 'asc' },
    take:    limit,
    include: { services: { select: { nameEn: true, nameAr: true }, take: 1 } },
  })

  const customerIds = [...new Set(bookings.map(b => b.customerId))]
  const customers = customerIds.length > 0
    ? await prisma.user.findMany({ where: { id: { in: customerIds } }, select: { id: true, name: true } })
    : []
  const nameMap = new Map(customers.map(c => [c.id, c.name]))

  return bookings.map(b => ({
    id:         b.id,
    clientName: nameMap.get(b.customerId) ?? 'Customer',
    service:    b.services[0]?.nameEn ?? '',
    serviceAr:  b.services[0]?.nameAr ?? '',
    time:       b.slot.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: 'Asia/Baghdad' }),
    status:     b.status === 'CONFIRMED' ? 'confirmed' as const : 'pending' as const,
  }))
}

export async function getDashboardBarbers(shopId: string | undefined) {
  if (!shopId) throw new AppError('not_found', 404)
  return prisma.barber.findMany({
    where:   { shopId, isActive: true },
    orderBy: { nameEn: 'asc' },
    select:  { id: true, nameEn: true, nameAr: true },
  })
}

const STATUS_MAP: Record<string, string> = {
  UPCOMING:  'pending',
  CONFIRMED: 'confirmed',
  COMPLETED: 'completed',
  CANCELLED: 'cancelled',
  NO_SHOW:   'cancelled',
}

export async function getDashboardAppointments(
  shopId:    string | undefined,
  dateFrom:  string,
  dateTo:    string,
  barberId?: string,
) {
  if (!shopId) throw new AppError('not_found', 404)

  const from = new Date(dateFrom); from.setHours(0, 0, 0, 0)
  const to   = new Date(dateTo);   to.setHours(23, 59, 59, 999)

  const bookings = await prisma.booking.findMany({
    where:   { shopId, slot: { gte: from, lte: to }, ...(barberId ? { barberId } : {}) },
    orderBy: { slot: 'asc' },
    take:    500,
    include: { services: { select: { nameEn: true, nameAr: true, durationMin: true }, take: 1 } },
  })

  const customerIds = [...new Set(bookings.map(b => b.customerId))]
  const barberIds   = [...new Set(bookings.map(b => b.barberId).filter(Boolean) as string[])]

  const [customers, barbers] = await Promise.all([
    customerIds.length > 0
      ? prisma.user.findMany({ where: { id: { in: customerIds } }, select: { id: true, name: true } })
      : Promise.resolve([]),
    barberIds.length > 0
      ? prisma.barber.findMany({ where: { id: { in: barberIds } }, select: { id: true, nameEn: true, nameAr: true } })
      : Promise.resolve([]),
  ])

  const nameMap   = new Map(customers.map(c => [c.id, c.name]))
  const barberMap = new Map(barbers.map(b => [b.id, b]))

  return bookings.map(b => {
    const svc = b.services[0]
    const dur = svc?.durationMin ?? 30
    const end = new Date(b.slot.getTime() + dur * 60_000)
    const fmt = (d: Date, o: Intl.DateTimeFormatOptions) => d.toLocaleString('en-CA', { ...o, timeZone: 'Asia/Baghdad' })
    const barber = b.barberId ? barberMap.get(b.barberId) : null

    return {
      id:           b.id,
      customerName: nameMap.get(b.customerId) ?? 'Customer',
      service:      svc?.nameEn ?? '',
      serviceAr:    svc?.nameAr ?? '',
      barberId:     b.barberId ?? '',
      barberName:   barber?.nameEn ?? b.barberName ?? '',
      barberNameAr: barber?.nameAr ?? b.barberName ?? '',
      date:         fmt(b.slot, { year: 'numeric', month: '2-digit', day: '2-digit' }).replace(/\//g, '-'),
      startTime:    fmt(b.slot, { hour: '2-digit', minute: '2-digit', hour12: false }),
      endTime:      fmt(end,    { hour: '2-digit', minute: '2-digit', hour12: false }),
      durationMin:  dur,
      status:       (STATUS_MAP[b.status] ?? 'pending') as 'confirmed' | 'pending' | 'completed' | 'cancelled',
      depositPaid:  b.depositPaid,
      totalPrice:   b.totalPrice,
    }
  })
}

export async function recordWalkInSale(
  userId: string,
  shopId: string | undefined,
  data: { serviceIds: string[]; barberId?: string; totalPrice: number; note?: string },
) {
  if (!shopId) throw new AppError('not_found', 404)

  const services = await prisma.service.findMany({
    where: { id: { in: data.serviceIds }, shopId },
  })
  if (services.length !== data.serviceIds.length) throw new AppError('not_found', 404)

  const barber = data.barberId
    ? await prisma.barber.findFirst({ where: { id: data.barberId, shopId } })
    : null

  return prisma.booking.create({
    data: {
      customerId:    userId,
      shopId,
      barberId:      barber?.id,
      barberName:    barber?.nameEn,
      slot:          new Date(),
      status:        'COMPLETED',
      totalPrice:    data.totalPrice,
      depositPaid:   0,
      paymentMethod: 'CASH',
      cancellationReason: data.note,
      services: {
        create: services.map(sv => ({
          serviceId:   sv.id,
          nameEn:      sv.nameEn,
          nameAr:      sv.nameAr,
          price:       sv.price,
          durationMin: sv.durationMin,
        })),
      },
    },
    include: { services: true },
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
