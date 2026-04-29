import { prisma } from '@/config/prisma'
import { AppError } from '@/lib/errors'

const DAY_KEYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'] as const

function buildAvailability(schedule: { dayOfWeek: number; startTime: string; endTime: string; isAvailable: boolean }[]) {
  const map: Record<string, { from: string; to: string } | null> = {
    mon: null, tue: null, wed: null, thu: null, fri: null, sat: null, sun: null,
  }
  for (const entry of schedule) {
    const key = DAY_KEYS[entry.dayOfWeek as 0 | 1 | 2 | 3 | 4 | 5 | 6]
    if (!key) continue
    map[key] = entry.isAvailable ? { from: entry.startTime, to: entry.endTime } : null
  }
  return map
}

export async function getBarberProfile(barberId: string) {
  const [barber, ratingAgg] = await Promise.all([
    prisma.barber.findUnique({
      where: { id: barberId },
      include: {
        shop:      { select: { id: true, nameEn: true, nameAr: true } },
        portfolio: { orderBy: { order: 'asc' }, take: 6 },
        schedule:  true,
      },
    }),
    prisma.review.aggregate({
      where: { barberId, isVisible: true },
      _avg:   { rating: true },
      _count: { id: true },
    }),
  ])

  if (!barber) throw new AppError('not_found', 404)

  return {
    id:           barber.id,
    nameEn:       barber.nameEn,
    nameAr:       barber.nameAr,
    avatar:       barber.photoUrl,
    isAvailable:  barber.isActive,
    shopId:       barber.shopId,
    shopNameEn:   barber.shop.nameEn,
    shopNameAr:   barber.shop.nameAr,
    yearsExp:     barber.experienceYears,
    avgRating:    Math.round((ratingAgg._avg.rating ?? 0) * 10) / 10,
    totalReviews: ratingAgg._count.id,
    bio:          barber.bio,
    bioAr:        barber.bioAr,
    serviceKeys:  barber.specialties,
    portfolio:    barber.portfolio.map(p => p.photoUrl),
    availability: buildAvailability(barber.schedule),
  }
}

export async function getBarberAvailability(barberId: string) {
  const barber = await prisma.barber.findUnique({ where: { id: barberId }, select: { id: true } })
  if (!barber) throw new AppError('not_found', 404)
  const schedule = await prisma.barberSchedule.findMany({ where: { barberId } })
  return buildAvailability(schedule)
}

export async function getBarberPortfolio(barberId: string) {
  const barber = await prisma.barber.findUnique({ where: { id: barberId }, select: { id: true } })
  if (!barber) throw new AppError('not_found', 404)
  const photos = await prisma.barberPortfolio.findMany({
    where: { barberId }, orderBy: { order: 'asc' }, take: 6,
  })
  return photos.map(p => p.photoUrl)
}

export async function getBarberReviews(barberId: string, page: number, limit: number) {
  const barber = await prisma.barber.findUnique({ where: { id: barberId }, select: { id: true } })
  if (!barber) throw new AppError('not_found', 404)

  const [reviews, total] = await Promise.all([
    prisma.review.findMany({
      where:   { barberId, isVisible: true },
      orderBy: { createdAt: 'desc' },
      skip:    (page - 1) * limit,
      take:    limit,
    }),
    prisma.review.count({ where: { barberId, isVisible: true } }),
  ])

  const customerIds = [...new Set(reviews.map(r => r.customerId))]
  const customers = await prisma.user.findMany({
    where:  { id: { in: customerIds } },
    select: { id: true, name: true },
  })
  const nameMap = Object.fromEntries(customers.map(c => [c.id, c.name]))

  return {
    reviews: reviews.map(r => ({
      id:      r.id,
      author:  nameMap[r.customerId] ?? 'Unknown',
      rating:  r.rating,
      comment: r.comment,
      date:    r.createdAt,
    })),
    total,
  }
}
