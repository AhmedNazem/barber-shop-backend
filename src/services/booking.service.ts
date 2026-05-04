import { prisma } from '@/config/prisma'
import { AppError } from '@/lib/errors'
import { PaymentMethod } from '@prisma/client'
import { createNotification } from '@/services/notification.service'

type CreateBookingInput = {
  shopId:        string
  barberId?:     string
  serviceIds:    string[]
  slot:          string
  paymentMethod: PaymentMethod
}

function calcDeposit(subtotal: number, depositPercent: number): number {
  const raw = subtotal * depositPercent / 100
  return Math.round(raw / 250) * 250
}

function hasOverlap(
  newSlot: Date,
  newDuration: number,
  bookings: Array<{ slot: Date; services: { durationMin: number }[] }>,
): boolean {
  const newEnd = newSlot.getTime() + newDuration * 60_000
  return bookings.some(b => {
    const bDur = b.services.reduce((s, sv) => s + sv.durationMin, 0) || 30
    const bEnd = b.slot.getTime() + bDur * 60_000
    return newSlot.getTime() < bEnd && newEnd > b.slot.getTime()
  })
}

export async function cancelBooking(bookingId: string, customerId: string) {
  const booking = await prisma.booking.findUnique({ where: { id: bookingId } })
  if (!booking) throw new AppError('not_found', 404)
  if (booking.customerId !== customerId) throw new AppError('forbidden', 403)
  if (!['UPCOMING', 'CONFIRMED'].includes(booking.status)) throw new AppError('already_resolved', 422)

  const twoHoursFromNow = new Date(Date.now() + 2 * 60 * 60 * 1000)
  const isLateCancellation = booking.slot < twoHoursFromNow

  await prisma.$transaction(async (tx) => {
    await tx.booking.update({
      where: { id: bookingId },
      data:  { status: 'CANCELLED', cancelledBy: customerId },
    })

    if (isLateCancellation) {
      await tx.reliabilityRecord.upsert({
        where:  { userId: customerId },
        update: { score: { decrement: 10 }, updatedAt: new Date() },
        create: { userId: customerId, score: Math.max(0, 90) },
      })
    }
  })

  await createNotification(
    customerId, 'CANCELLATION',
    'Booking Cancelled', 'تم إلغاء الحجز',
    'Your booking has been cancelled.', 'تم إلغاء حجزك.',
    { bookingId },
  )
}

export async function getBookingById(bookingId: string, customerId: string) {
  const booking = await prisma.booking.findUnique({
    where:   { id: bookingId },
    include: { services: true },
  })
  if (!booking) throw new AppError('not_found', 404)
  if (booking.customerId !== customerId) throw new AppError('forbidden', 403)
  return booking
}

export async function getBookings(customerId: string) {
  return prisma.booking.findMany({
    where:   { customerId },
    orderBy: { slot: 'desc' },
    include: { services: true },
  })
}

export async function createBooking(customerId: string, input: CreateBookingInput) {
  // 1. Reliability guard
  const reliability = await prisma.reliabilityRecord.findUnique({ where: { userId: customerId } })
  if (reliability && reliability.score < 50) throw new AppError('low_reliability', 403)

  // 2. Validate shop
  const shop = await prisma.shop.findUnique({
    where:   { id: input.shopId },
    include: { discount: true },
  })
  if (!shop || !shop.isActive) throw new AppError('not_found', 404)
  if (shop.plan === 'FREE') throw new AppError('plan_required', 403)
  if (shop.bookingMode === 'QUEUE_ONLY') throw new AppError('booking_disabled', 422)

  // 3. Validate services belong to this shop
  const services = await prisma.service.findMany({
    where: { id: { in: input.serviceIds }, shopId: input.shopId, isActive: true },
  })
  if (services.length !== input.serviceIds.length) throw new AppError('not_found', 404)

  // 4. Totals
  const subtotal    = services.reduce((s, sv) => s + sv.price, 0)
  const totalDurMin = services.reduce((s, sv) => s + sv.durationMin, 0)

  // 5. Discount
  let discountPct = 0
  if (shop.discount) {
    const d = shop.discount
    const active = d.expiresAt > new Date() && d.slotsClaimed < d.maxUsers
    if (active) discountPct = d.pct
  }
  const discountedSubtotal = Math.round(subtotal * (1 - discountPct / 100))

  // 6. Deposit
  const depositPaid = shop.depositRequired
    ? calcDeposit(discountedSubtotal, shop.depositPercent)
    : 0

  const slotDate = new Date(input.slot)
  if (isNaN(slotDate.getTime())) throw new AppError('invalid_date', 400)

  // 7. Transaction: conflict check + create
  return prisma.$transaction(async (tx) => {
    if (input.barberId) {
      const conflicts = await tx.booking.findMany({
        where: {
          barberId: input.barberId,
          status:   { in: ['UPCOMING', 'CONFIRMED'] },
          slot:     { gte: new Date(slotDate.getTime() - 120 * 60_000), lte: new Date(slotDate.getTime() + 120 * 60_000) },
        },
        include: { services: { select: { durationMin: true } } },
      })
      if (hasOverlap(slotDate, totalDurMin, conflicts)) throw new AppError('slot_taken', 409)
    }

    // Claim discount slot if applicable
    if (discountPct > 0 && shop.discount) {
      await tx.shopDiscount.update({
        where: { shopId: input.shopId },
        data:  { slotsClaimed: { increment: 1 } },
      })
    }

    const barber = input.barberId
      ? await tx.barber.findFirst({ where: { id: input.barberId, shopId: input.shopId } })
      : null

    const booking = await tx.booking.create({
      data: {
        customerId,
        shopId:        input.shopId,
        barberId:      input.barberId,
        barberName:    barber?.nameEn,
        slot:          slotDate,
        totalPrice:    discountedSubtotal,
        depositPaid,
        discountPct:   discountPct || null,
        paymentMethod: input.paymentMethod,
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

    return booking
  }).then(async (booking) => {
    await createNotification(
      customerId, 'BOOKING_CONFIRMED',
      'Booking Confirmed', 'تم تأكيد الحجز',
      'Your booking has been confirmed.', 'تم تأكيد حجزك بنجاح.',
      { bookingId: booking.id },
    )
    return booking
  })
}
