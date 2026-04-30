import { prisma } from '@/config/prisma'
import { AppError } from '@/lib/errors'

const REGULAR_DAYS_AHEAD = 3
const VIP_DAYS_AHEAD = 7
const SLOT_MINUTES = 30

function parseTime(timeStr: string, baseDate: Date): Date {
  const [h, m] = timeStr.split(':').map(Number)
  const d = new Date(baseDate)
  d.setUTCHours(h!, m!, 0, 0)
  return d
}

function generateSlots(start: Date, end: Date): Date[] {
  const slots: Date[] = []
  const cur = new Date(start)
  while (cur < end) {
    slots.push(new Date(cur))
    cur.setUTCMinutes(cur.getUTCMinutes() + SLOT_MINUTES)
  }
  return slots
}

type BookingWithServices = { slot: Date; services: { durationMin: number }[] }

function getBookingDuration(b: BookingWithServices): number {
  if (b.services.length === 0) return SLOT_MINUTES
  return b.services.reduce((sum, s) => sum + s.durationMin, 0)
}

function filterFreeSlots(slots: Date[], bookings: BookingWithServices[]): Date[] {
  return slots.filter(slot => {
    return !bookings.some(b => {
      const start = b.slot.getTime()
      const end = start + getBookingDuration(b) * 60_000
      return slot.getTime() >= start && slot.getTime() < end
    })
  })
}

async function getBarberFreeSlots(
  shopId: string,
  barberId: string,
  target: Date,
): Promise<Date[]> {
  const dayOfWeek = target.getUTCDay()

  const schedule = await prisma.barberSchedule.findFirst({
    where: { barberId, barber: { shopId }, dayOfWeek, isAvailable: true },
  })
  if (!schedule) return []

  const slotStart = parseTime(schedule.startTime, target)
  const slotEnd   = parseTime(schedule.endTime,   target)
  const allSlots  = generateSlots(slotStart, slotEnd)

  const dayEnd = new Date(target)
  dayEnd.setUTCDate(dayEnd.getUTCDate() + 1)

  const bookings = await prisma.booking.findMany({
    where: {
      barberId,
      slot:   { gte: target, lt: dayEnd },
      status: { in: ['UPCOMING', 'CONFIRMED'] },
    },
    include: { services: { select: { durationMin: true } } },
  })

  return filterFreeSlots(allSlots, bookings)
}

function validateDateWindow(date: string, isVip: boolean): Date {
  const today = new Date()
  today.setUTCHours(0, 0, 0, 0)

  const target = new Date(date)
  if (isNaN(target.getTime())) throw new AppError('invalid_date', 400)
  target.setUTCHours(0, 0, 0, 0)

  if (target < today) throw new AppError('date_in_past', 400)

  const maxDays = isVip ? VIP_DAYS_AHEAD : REGULAR_DAYS_AHEAD
  const maxDate = new Date(today)
  maxDate.setUTCDate(maxDate.getUTCDate() + maxDays)
  if (target >= maxDate) throw new AppError('date_too_far', 400)

  return target
}

export async function getShopAvailability(
  shopId: string,
  date: string,
  barberId: string | undefined,
  isVip: boolean,
): Promise<string[]> {
  const target = validateDateWindow(date, isVip)

  if (barberId) {
    const slots = await getBarberFreeSlots(shopId, barberId, target)
    return slots.map(s => s.toISOString())
  }

  const barbers = await prisma.barber.findMany({
    where: { shopId, isActive: true },
    select: { id: true },
  })

  const results = await Promise.all(
    barbers.map(b => getBarberFreeSlots(shopId, b.id, target)),
  )

  const merged = [...new Set(results.flat().map(s => s.toISOString()))].sort()
  return merged
}
