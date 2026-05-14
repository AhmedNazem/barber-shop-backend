import { prisma } from '@/config/prisma'
import { AppError } from '@/lib/errors'

const REGULAR_DAYS_AHEAD = 14
const VIP_DAYS_AHEAD = 30
const SLOT_MINUTES = 30

const IRAQ_OFFSET_MS = 3 * 60 * 60 * 1000

function getBaghdadMidnight(dateStr?: string): Date {
  const d = dateStr ? new Date(dateStr) : new Date()
  if (isNaN(d.getTime())) return new Date(NaN)
  const local = new Date(d.getTime() + IRAQ_OFFSET_MS)
  local.setUTCHours(0, 0, 0, 0)
  return new Date(local.getTime() - IRAQ_OFFSET_MS)
}

function parseTime(timeStr: string, baseDateBaghdadMidnight: Date): Date {
  const [h, m] = timeStr.split(':').map(Number)
  const d = new Date(baseDateBaghdadMidnight)
  d.setUTCHours(d.getUTCHours() + h!, d.getUTCMinutes() + m!, 0, 0)
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

// Top-of-hour slots (minutes === 0) are reserved for VIP customers
function applyVipFilter(slots: Date[], isVip: boolean, vipLaneEnabled: boolean): Date[] {
  if (!vipLaneEnabled || isVip) return slots
  return slots.filter(s => s.getUTCMinutes() !== 0)
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

  const dayEnd = new Date(target.getTime() + 24 * 60 * 60 * 1000)

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
  const todayBaghdad = getBaghdadMidnight()
  const targetBaghdad = getBaghdadMidnight(date)

  if (isNaN(targetBaghdad.getTime())) throw new AppError('invalid_date', 400)
  if (targetBaghdad < todayBaghdad) throw new AppError('date_in_past', 400)

  const maxDays = isVip ? VIP_DAYS_AHEAD : REGULAR_DAYS_AHEAD
  const maxDate = new Date(todayBaghdad.getTime() + maxDays * 24 * 60 * 60 * 1000)
  if (targetBaghdad >= maxDate) throw new AppError('date_too_far', 400)

  return targetBaghdad
}

export async function getShopAvailability(
  shopId: string,
  date: string,
  barberId: string | undefined,
  isVip: boolean,
): Promise<string[]> {
  const target = validateDateWindow(date, isVip)

  const shop = await prisma.shop.findUnique({ where: { id: shopId }, select: { vipLaneEnabled: true } })
  const vipLaneEnabled = shop?.vipLaneEnabled ?? false

  if (barberId) {
    const slots = await getBarberFreeSlots(shopId, barberId, target)
    return applyVipFilter(slots, isVip, vipLaneEnabled).map(s => s.toISOString())
  }

  const barbers = await prisma.barber.findMany({
    where: { shopId, isActive: true },
    select: { id: true },
  })

  const results = await Promise.all(
    barbers.map(b => getBarberFreeSlots(shopId, b.id, target)),
  )

  const allDates = [...new Set(results.flat().map(s => s.toISOString()))].sort().map(s => new Date(s))
  return applyVipFilter(allDates, isVip, vipLaneEnabled).map(s => s.toISOString())
}
