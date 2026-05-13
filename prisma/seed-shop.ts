/**
 * Full test seed for shop cmojy02aa000084w9i2lkeii1
 * Run: npx tsx prisma/seed-shop.ts
 */
import { PrismaClient, PaymentMethod, PaymentStatus, BookingStatus, QueueStatus, FlagStatus, FlagReason } from '@prisma/client'
import { randomBytes } from 'crypto'

const prisma = new PrismaClient()
const SHOP_ID = 'cmojy02aa000084w9i2lkeii1'

function refCode() { return 'BBQ-' + randomBytes(3).toString('hex').toUpperCase() }
function daysAgo(n: number) { const d = new Date(); d.setDate(d.getDate() - n); d.setHours(10, 0, 0, 0); return d }
function daysFromNow(n: number, h = 10) { const d = new Date(); d.setDate(d.getDate() + n); d.setHours(h, 0, 0, 0); return d }

async function main() {
  // ── 1. Update shop ──────────────────────────────────────────────────────────
  await prisma.shop.update({
    where: { id: SHOP_ID },
    data: {
      nameEn:         'Al-Nour Barbershop',
      nameAr:         'صالون النور للحلاقة',
      address:        'Al-Mansour Street, Baghdad',
      city:           'Baghdad',
      neighborhood:   'Al-Mansour',
      neighborhoodAr: 'المنصور',
      phone:          '+9647801234567',
      lat:            33.3152,
      lng:            44.3661,
      priceRange:     'MID',
      status:         'APPROVED',
      plan:           'PRO',
      planUpdatedAt:  new Date(),
      planExpiresAt:  daysFromNow(365),
      bookingMode:    'BOTH',
      depositRequired: true,
      depositPercent: 20,
      vipLaneEnabled: true,
      isActive:       true,
    },
  })
  console.log('✓ Shop updated')

  // ── 2. Business hours (Sun–Thu open, Fri–Sat closed) ────────────────────────
  await prisma.businessHours.deleteMany({ where: { shopId: SHOP_ID } })
  const hours = [
    { dayOfWeek: 0, openTime: '09:00', closeTime: '21:00', isClosed: false }, // Sun
    { dayOfWeek: 1, openTime: '09:00', closeTime: '21:00', isClosed: false }, // Mon
    { dayOfWeek: 2, openTime: '09:00', closeTime: '21:00', isClosed: false }, // Tue
    { dayOfWeek: 3, openTime: '09:00', closeTime: '21:00', isClosed: false }, // Wed
    { dayOfWeek: 4, openTime: '09:00', closeTime: '21:00', isClosed: false }, // Thu
    { dayOfWeek: 5, openTime: '09:00', closeTime: '14:00', isClosed: false }, // Fri (half-day)
    { dayOfWeek: 6, openTime: '09:00', closeTime: '21:00', isClosed: true  }, // Sat (closed)
  ]
  await prisma.businessHours.createMany({ data: hours.map(h => ({ ...h, shopId: SHOP_ID })) })
  console.log('✓ Business hours created')

  // ── 3. Services ─────────────────────────────────────────────────────────────
  await prisma.service.deleteMany({ where: { shopId: SHOP_ID } })
  const services = await Promise.all([
    prisma.service.create({ data: { shopId: SHOP_ID, nameEn: 'Classic Haircut', nameAr: 'قصة شعر كلاسيكية', price: 5000,  durationMin: 30, category: 'haircut',  isActive: true } }),
    prisma.service.create({ data: { shopId: SHOP_ID, nameEn: 'Beard Trim',     nameAr: 'تشذيب اللحية',       price: 3000,  durationMin: 20, category: 'beard',    isActive: true } }),
    prisma.service.create({ data: { shopId: SHOP_ID, nameEn: 'Hot Towel Shave',nameAr: 'حلاقة بالمنشفة الساخنة', price: 7500, durationMin: 40, category: 'shave', isActive: true } }),
    prisma.service.create({ data: { shopId: SHOP_ID, nameEn: 'Hair Wash + Cut', nameAr: 'غسيل وقص الشعر',    price: 8000,  durationMin: 45, category: 'haircut',  isActive: true } }),
    prisma.service.create({ data: { shopId: SHOP_ID, nameEn: "Kids Haircut",    nameAr: 'قصة شعر أطفال',     price: 3500,  durationMin: 20, category: 'haircut',  isActive: true } }),
  ])
  console.log('✓ Services created:', services.map(s => s.nameEn).join(', '))

  // ── 4. Barbers ──────────────────────────────────────────────────────────────
  await prisma.barberSchedule.deleteMany({ where: { barber: { shopId: SHOP_ID } } })
  await prisma.barber.deleteMany({ where: { shopId: SHOP_ID } })
  const workDays = [0,1,2,3,4,5].map(day => ({ dayOfWeek: day, startTime: '09:00', endTime: '21:00', isAvailable: true }))
  const [barber1, barber2] = await Promise.all([
    prisma.barber.create({
      data: {
        shopId: SHOP_ID, nameEn: 'Ahmed Al-Rashid', nameAr: 'أحمد الرشيد',
        specialties: ['fade', 'beard'], experienceYears: 5, isActive: true,
        schedule: { create: workDays },
      },
    }),
    prisma.barber.create({
      data: {
        shopId: SHOP_ID, nameEn: 'Omar Hassan', nameAr: 'عمر حسن',
        specialties: ['classic', 'kids'], experienceYears: 3, isActive: true,
        schedule: { create: workDays },
      },
    }),
  ])
  console.log('✓ Barbers created:', barber1.nameEn, '&', barber2.nameEn)

  // ── 5. Customer = shop owner's own account (no fake phone needed) ────────────
  const shop = await prisma.shop.findUnique({ where: { id: SHOP_ID }, select: { ownerId: true } })
  if (!shop?.ownerId) throw new Error('Shop has no ownerId — set it in Prisma Studio first')
  const customer = await prisma.user.findUniqueOrThrow({ where: { id: shop.ownerId } })
  await prisma.reliabilityRecord.upsert({
    where:  { userId: customer.id },
    update: {},
    create: { userId: customer.id, score: 100, noShowCount: 0 },
  })
  console.log('✓ Using shop owner as test customer:', customer.id, customer.phone)

  // ── 6. Discount ─────────────────────────────────────────────────────────────
  await prisma.shopDiscount.upsert({
    where:  { shopId: SHOP_ID },
    update: { pct: 15, maxUsers: 50, slotsClaimed: 12, expiresAt: daysFromNow(7) },
    create: { shopId: SHOP_ID, pct: 15, maxUsers: 50, slotsClaimed: 12, expiresAt: daysFromNow(7) },
  })
  console.log('✓ Discount: 15% off (12/50 claimed)')

  const [svc1, svc2, svc3, svc4] = services

  // ── 7. Bookings ─────────────────────────────────────────────────────────────
  // Helper: create booking + services snapshot
  async function mkBooking(opts: {
    slot: Date; status: BookingStatus; payStatus: PaymentStatus; method: PaymentMethod;
    barberId: string; svc: typeof svc1; withProof?: boolean; withReview?: boolean
    cancel?: string; noShow?: boolean
  }) {
    const deposit = Math.round((opts.svc.price * 0.20) / 250) * 250
    const rc = refCode()
    const b = await prisma.booking.create({
      data: {
        customerId: customer.id, shopId: SHOP_ID,
        barberId: opts.barberId, barberName: opts.barberId === barber1.id ? barber1.nameEn : barber2.nameEn,
        slot: opts.slot, status: opts.status,
        totalPrice: opts.svc.price, depositPaid: deposit,
        refCode: rc, paymentMethod: opts.method, paymentStatus: opts.payStatus,
        ...(opts.cancel && { cancelledBy: customer.id, cancellationReason: opts.cancel }),
        services: { create: [{ serviceId: opts.svc.id, nameEn: opts.svc.nameEn, nameAr: opts.svc.nameAr, price: opts.svc.price, durationMin: opts.svc.durationMin }] },
      },
    })
    if (opts.withProof) {
      await prisma.manualPaymentProof.create({ data: { bookingId: b.id, referenceNote: rc } })
    }
    return b
  }

  // Clear old bookings for this shop
  await prisma.manualPaymentProof.deleteMany({ where: { booking: { shopId: SHOP_ID } } })
  await prisma.review.deleteMany({ where: { shopId: SHOP_ID } })
  await prisma.queueEntry.deleteMany({ where: { shopId: SHOP_ID } })
  await prisma.booking.deleteMany({ where: { shopId: SHOP_ID } })

  // 7a. Upcoming (future, cash — no deposit)
  const bUpcoming = await prisma.booking.create({
    data: {
      customerId: customer.id, shopId: SHOP_ID,
      barberId: barber1.id, barberName: barber1.nameEn,
      slot: daysFromNow(2, 11), status: 'UPCOMING',
      totalPrice: svc1!.price, depositPaid: 0, refCode: refCode(),
      paymentMethod: 'CASH', paymentStatus: 'PENDING',
      services: { create: [{ serviceId: svc1!.id, nameEn: svc1!.nameEn, nameAr: svc1!.nameAr, price: svc1!.price, durationMin: svc1!.durationMin }] },
    },
  })

  // 7b. Awaiting confirmation (ZainCash, proof submitted)
  const bAwait = await mkBooking({ slot: daysFromNow(1, 14), status: 'UPCOMING', payStatus: 'AWAITING_CONFIRMATION', method: 'ZAINCASH', barberId: barber2.id, svc: svc2!, withProof: true })

  // 7c. Confirmed (FIB, paid)
  const bConfirmed = await mkBooking({ slot: daysFromNow(3, 10), status: 'CONFIRMED', payStatus: 'PAID', method: 'FIB', barberId: barber1.id, svc: svc3! })

  // 7d–7n. Completed past bookings spread over last 30 days (for analytics)
  const completedSlots = [
    { daysAgo: 1,  h: 10, svc: svc1!, b: barber1.id },
    { daysAgo: 1,  h: 14, svc: svc2!, b: barber2.id },
    { daysAgo: 2,  h: 11, svc: svc3!, b: barber1.id },
    { daysAgo: 3,  h: 10, svc: svc1!, b: barber2.id },
    { daysAgo: 3,  h: 15, svc: svc4!, b: barber1.id },
    { daysAgo: 5,  h: 10, svc: svc1!, b: barber1.id },
    { daysAgo: 5,  h: 13, svc: svc2!, b: barber2.id },
    { daysAgo: 7,  h: 10, svc: svc3!, b: barber1.id },
    { daysAgo: 7,  h: 16, svc: svc1!, b: barber2.id },
    { daysAgo: 10, h: 11, svc: svc4!, b: barber1.id },
    { daysAgo: 12, h: 10, svc: svc1!, b: barber2.id },
    { daysAgo: 14, h: 14, svc: svc2!, b: barber1.id },
    { daysAgo: 17, h: 10, svc: svc1!, b: barber1.id },
    { daysAgo: 20, h: 11, svc: svc3!, b: barber2.id },
    { daysAgo: 23, h: 10, svc: svc4!, b: barber1.id },
    { daysAgo: 25, h: 15, svc: svc1!, b: barber2.id },
    { daysAgo: 28, h: 10, svc: svc2!, b: barber1.id },
    { daysAgo: 30, h: 13, svc: svc1!, b: barber2.id },
  ]
  const completedBookings = []
  for (const s of completedSlots) {
    const slot = daysAgo(s.daysAgo); slot.setHours(s.h, 0, 0, 0)
    const b = await mkBooking({ slot, status: 'COMPLETED', payStatus: 'PAID', method: 'CASH', barberId: s.b, svc: s.svc })
    completedBookings.push(b)
  }

  // 7o. Cancelled booking
  await mkBooking({ slot: daysAgo(4), status: 'CANCELLED', payStatus: 'FAILED', method: 'ZAINCASH', barberId: barber1.id, svc: svc1!, cancel: 'Changed my mind' })

  // 7p. No-show
  await mkBooking({ slot: daysAgo(6), status: 'NO_SHOW', payStatus: 'PAID', method: 'FIB', barberId: barber2.id, svc: svc2! })

  console.log(`✓ Bookings: 1 upcoming, 1 awaiting confirmation, 1 confirmed, ${completedBookings.length} completed, 1 cancelled, 1 no-show`)

  // ── 8. Reviews on completed bookings ────────────────────────────────────────
  const reviewData = [
    { rating: 5, comment: 'Best barbershop in Baghdad! Ahmed is incredibly skilled.', flag: null },
    { rating: 4, comment: 'Great service, very clean. Will definitely come back.', flag: null },
    { rating: 5, comment: 'Amazing fade, exactly what I wanted.', flag: null },
    { rating: 3, comment: 'Good but had to wait a bit longer than expected.', flag: null },
    { rating: 1, comment: 'SPAM SPAM BUY FOLLOWERS HERE', flag: { status: FlagStatus.PENDING, reason: FlagReason.SPAM } },
    { rating: 2, comment: 'Fake review — this shop paid me to write this.', flag: { status: FlagStatus.PENDING, reason: FlagReason.FAKE } },
    { rating: 5, comment: 'Hot towel shave was absolutely perfect, very relaxing.', flag: null },
    { rating: 4, comment: 'Clean shop, friendly staff, reasonable prices.', flag: null },
  ]
  for (let i = 0; i < Math.min(reviewData.length, completedBookings.length); i++) {
    const rd = reviewData[i]!
    await prisma.review.create({
      data: {
        bookingId: completedBookings[i]!.id,
        customerId: customer.id,
        shopId: SHOP_ID,
        barberId: completedBookings[i]!.barberId,
        rating: rd.rating,
        comment: rd.comment,
        isVisible: !rd.flag,
        ...(rd.flag && { flagStatus: rd.flag.status, flagReason: rd.flag.reason, flaggedAt: new Date(), flaggedBy: 'system' }),
      },
    })
    await prisma.booking.update({ where: { id: completedBookings[i]!.id }, data: { hasReview: true } })
  }
  console.log(`✓ Reviews: ${reviewData.filter(r => !r.flag).length} visible, ${reviewData.filter(r => r.flag).length} flagged (pending moderation)`)

  // ── 9. Queue entries ─────────────────────────────────────────────────────────
  await prisma.queueEntry.createMany({
    data: [
      { shopId: SHOP_ID, customerName: 'Walk-in 1',  serviceIds: [svc1!.id], barberId: barber1.id, position: 1, isVip: false, status: QueueStatus.IN_CHAIR,  estimatedWait: 0  },
      { shopId: SHOP_ID, customerName: 'Walk-in 2',  serviceIds: [svc2!.id], barberId: barber1.id, position: 2, isVip: false, status: QueueStatus.WAITING,  estimatedWait: 30 },
      { shopId: SHOP_ID, customerName: 'VIP Client',  serviceIds: [svc3!.id], barberId: barber2.id, position: 3, isVip: true,  status: QueueStatus.WAITING,  estimatedWait: 15 },
      { shopId: SHOP_ID, customerName: 'Walk-in 3',  serviceIds: [svc1!.id], barberId: barber2.id, position: 4, isVip: false, status: QueueStatus.WAITING,  estimatedWait: 45 },
    ],
  })
  // Link one queue entry to the upcoming booking
  await prisma.queueEntry.create({
    data: {
      shopId: SHOP_ID, bookingId: bUpcoming.id,
      customerName: customer.name ?? 'Test Customer',
      serviceIds: [svc1!.id], barberId: barber1.id,
      position: 5, isVip: false, status: QueueStatus.WAITING, estimatedWait: 60,
    },
  })
  console.log('✓ Queue: 1 in-chair, 3 waiting walk-ins, 1 linked booking')

  console.log('\n🎉 Shop fully seeded! Shop ID:', SHOP_ID)
  console.log('   Test customer phone: +9647700000001')
  console.log('   Pending payment ref: check /admin/payments')
  console.log('   Pending moderation:  check /admin/moderation (2 flagged reviews)')
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect())
