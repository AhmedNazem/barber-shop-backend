import { Router } from 'express'
import { prisma } from '@/config/prisma'
import { createNotification } from '@/services/notification.service'

export const testHelpersRouter = Router()

if (process.env.NODE_ENV !== 'production') {
  // Seed a stale PENDING payment linked to fresh test fixtures
  testHelpersRouter.post('/seed-expired-payment', async (_req, res) => {
    const user = await prisma.user.upsert({
      where: { phone: '+9647700000999' },
      update: {},
      create: { phone: '+9647700000999', name: 'PW Test Customer', role: 'CUSTOMER' },
    })
    await prisma.shop.upsert({
      where: { id: 'pw-test-shop-1' },
      update: {},
      create: {
        id: 'pw-test-shop-1',
        nameEn: 'PW Test Shop', nameAr: 'محل اختبار',
        address: 'Test St', city: 'Baghdad',
        neighborhood: 'Test', neighborhoodAr: 'اختبار',
        phone: '+9647700001000', lat: 33.34, lng: 44.36,
      },
    })
    const booking = await prisma.booking.create({
      data: {
        customerId: user.id, shopId: 'pw-test-shop-1',
        slot: new Date(Date.now() + 86_400_000),
        paymentMethod: 'ZAINCASH',
        totalPrice: 10_000, depositPaid: 2_000,
        vatAmount: 0, platformFee: 0, shopPayout: 8_000,
      },
    })
    const payment = await prisma.payment.create({
      data: {
        bookingId: booking.id,
        provider: 'ZAINCASH', status: 'PENDING',
        amount: 10_000, depositAmount: 2_000, remainingAmount: 8_000,
        idempotencyKey: `PW-TEST-${booking.id}`,
        expiresAt: new Date(Date.now() - 60_000),
      },
    })
    res.json({ paymentId: payment.id, bookingId: booking.id })
  })

  // Run the same expiry logic as the cleanup worker
  testHelpersRouter.post('/run-payment-expiry', async (_req, res) => {
    const expired = await prisma.payment.findMany({
      where: { status: 'PENDING', expiresAt: { lt: new Date() } },
      select: { id: true, bookingId: true },
    })
    if (!expired.length) { res.json({ count: 0 }); return }

    const paymentIds = expired.map(p => p.id)
    const bookingIds = expired.map(p => p.bookingId)
    const bookings = await prisma.booking.findMany({
      where: { id: { in: bookingIds } },
      select: { id: true, customerId: true },
    })
    await prisma.$transaction([
      prisma.payment.updateMany({ where: { id: { in: paymentIds } }, data: { status: 'FAILED' } }),
      prisma.booking.updateMany({ where: { id: { in: bookingIds } }, data: { status: 'CANCELLED', cancellationReason: 'payment_expired' } }),
    ])
    await Promise.all(
      bookings.map(b =>
        createNotification(b.customerId, 'SYSTEM_ALERT', 'Payment Expired', 'انتهت مهلة الدفع',
          'Your checkout session expired.', 'انتهت مهلة إتمام الدفع.', { bookingId: b.id }).catch(() => {}),
      ),
    )
    res.json({ count: expired.length })
  })

  // Check the state of a payment + its booking
  testHelpersRouter.get('/payment-status/:paymentId', async (req, res) => {
    const payment = await prisma.payment.findUnique({
      where: { id: req.params['paymentId'] },
      include: { booking: { select: { status: true, cancellationReason: true } } },
    })
    if (!payment) { res.status(404).json({ error: 'not_found' }); return }
    res.json({ payment: { status: payment.status }, booking: payment.booking })
  })

  // Remove all test fixtures
  testHelpersRouter.delete('/cleanup-test-data', async (_req, res) => {
    await prisma.payment.deleteMany({ where: { idempotencyKey: { startsWith: 'PW-TEST-' } } })
    await prisma.booking.deleteMany({ where: { shopId: 'pw-test-shop-1' } })
    await prisma.shop.deleteMany({ where: { id: 'pw-test-shop-1' } })
    await prisma.user.deleteMany({ where: { phone: '+9647700000999' } })
    res.json({ ok: true })
  })
}
