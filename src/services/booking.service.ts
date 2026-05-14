import { randomBytes } from 'crypto'
import { prisma } from '@/config/prisma'
import { AppError } from '@/lib/errors'
import { PaymentMethod } from '@prisma/client'
import { createNotification } from '@/services/notification.service'
import { applyReliabilityEvent } from '@/services/reliability.service'

function generateRefCode(): string {
  return 'BBQ-' + randomBytes(3).toString('hex').toUpperCase()
}

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

  const hoursUntilSlot = (booking.slot.getTime() - Date.now()) / 3_600_000
  const isLateCancellation = hoursUntilSlot < 2

  const refundAmount =
    hoursUntilSlot >= 24 ? booking.depositPaid :
    hoursUntilSlot >= 2  ? Math.floor(booking.depositPaid * 0.5) :
    0

  await prisma.booking.update({
    where: { id: bookingId },
    data:  {
      status: 'CANCELLED',
      cancelledBy: customerId,
      refundAmount,
      depositRefunded: false, // set to true once payment gateway processes the reversal
    },
  })

  if (isLateCancellation) {
    await applyReliabilityEvent(customerId, 'LATE_CANCEL')
  }

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

export async function getBookingForReceipt(bookingId: string, customerId: string) {
  const booking = await prisma.booking.findUnique({
    where:   { id: bookingId },
    include: {
      services: true,
      shop: { select: { nameEn: true, nameAr: true, address: true } },
    },
  })
  if (!booking) throw new AppError('not_found', 404)
  if (booking.customerId !== customerId) throw new AppError('forbidden', 403)
  // Back-fill VAT for bookings created before this feature (vatAmount = 0 in DB)
  if (booking.vatAmount === 0) {
    booking.vatAmount = Math.round(booking.totalPrice * 0.15 / 250) * 250
  }
  return booking
}

export async function getBookings(customerId: string) {
  return prisma.booking.findMany({
    where:   { customerId },
    orderBy: { slot: 'desc' },
    take:    50,
    include: { services: true },
  })
}

export async function createBooking(customerId: string, isVip: boolean, input: CreateBookingInput) {
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

  // 5. Discount (preliminary — confirmed atomically inside the transaction)
  let discountPct = 0
  if (shop.discount) {
    const d = shop.discount
    const active = d.expiresAt > new Date() && d.slotsClaimed < d.maxUsers
    if (active) discountPct = d.pct
  }
  let discountedSubtotal = Math.round(subtotal * (1 - discountPct / 100))

  // 6. VAT (15%) + deposit
  const vatAmount  = Math.round(discountedSubtotal * 0.15 / 250) * 250
  let depositPaid = shop.depositRequired
    ? calcDeposit(discountedSubtotal, shop.depositPercent)
    : 0

  const slotDate = new Date(input.slot)
  if (isNaN(slotDate.getTime())) throw new AppError('invalid_date', 400)

  // 6.5 Timezone validation (Asia/Baghdad)
  const IRAQ_OFFSET_MS = 3 * 60 * 60 * 1000
  const baghdadTime = new Date(slotDate.getTime() + IRAQ_OFFSET_MS)
  const baghdadDayOfWeek = baghdadTime.getUTCDay()

  const shopHours = await prisma.businessHours.findFirst({
    where: { shopId: input.shopId, dayOfWeek: baghdadDayOfWeek }
  })

  if (!shopHours || shopHours.isClosed) throw new AppError('shop_closed', 422)

  const [openH, openM] = shopHours.openTime.split(':').map(Number)
  const [closeH, closeM] = shopHours.closeTime.split(':').map(Number)

  const slotTotalMins = baghdadTime.getUTCHours() * 60 + baghdadTime.getUTCMinutes()
  const openTotalMins = openH! * 60 + openM!
  const closeTotalMins = closeH! * 60 + closeM!

  if (slotTotalMins < openTotalMins || slotTotalMins + totalDurMin > closeTotalMins) {
    throw new AppError('outside_open_hours', 422)
  }

  // VIP lane: top-of-hour slots (minutes === 0) are reserved for VIP customers
  if (shop.vipLaneEnabled && !isVip && slotDate.getUTCMinutes() === 0) {
    throw new AppError('vip_slot_only', 403)
  }

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

    // Atomically claim one discount slot — uses updateMany so 0 rows = maxed out
    if (discountPct > 0 && shop.discount) {
      const claimed = await tx.shopDiscount.updateMany({
        where: { shopId: input.shopId, slotsClaimed: { lt: shop.discount.maxUsers } },
        data:  { slotsClaimed: { increment: 1 } },
      })
      if (claimed.count === 0) {
        // Concurrent request claimed the last slot — fall back to full price
        discountPct          = 0
        discountedSubtotal   = subtotal
        depositPaid          = shop.depositRequired ? calcDeposit(subtotal, shop.depositPercent) : 0
      }
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
        refCode:       generateRefCode(),
        totalPrice:    discountedSubtotal,
        vatAmount,
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
  }, { timeout: 30_000 }).then((booking) => {
    // fire-and-forget — don't block the booking response
    applyReliabilityEvent(customerId, 'ON_TIME').catch(() => {})
    createNotification(
      customerId, 'BOOKING_CONFIRMED',
      'Booking Confirmed', 'تم تأكيد الحجز',
      'Your booking has been confirmed.', 'تم تأكيد حجزك بنجاح.',
      { bookingId: booking.id },
    ).catch(() => {})
    return booking
  })
}
