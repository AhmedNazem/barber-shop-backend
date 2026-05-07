import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import request from 'supertest'
import { createApp } from '@/app'
import { prisma } from '@/config/prisma'
import { signAccess } from '@/lib/jwt'
import { cleanupPhone } from '../helpers/auth'

vi.mock('@/lib/sms', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/sms')>()
  return { ...actual, sendSms: vi.fn().mockResolvedValue(undefined) }
})

const app = createApp({ NODE_ENV: 'test', CORS_ORIGIN: 'http://localhost:3000' })

const E164_ADMIN    = '+9647900000200'
const E164_OWNER    = '+9647900000201'
const E164_CUSTOMER = '+9647900000202'

async function cleanupAll() {
  const users = await prisma.user.findMany({
    where:  { phone: { in: [E164_ADMIN, E164_OWNER, E164_CUSTOMER] } },
    select: { id: true },
  })
  const userIds = users.map(u => u.id)

  const shops = await prisma.shop.findMany({
    where:  { ownerId: { in: userIds } },
    select: { id: true },
  })
  const shopIds = shops.map(s => s.id)

  await prisma.notification.deleteMany({ where: { userId: { in: userIds } } })
  await prisma.review.deleteMany({ where: { shopId: { in: shopIds } } })
  await prisma.loyaltyTransaction.deleteMany({ where: { userId: { in: userIds } } })
  await prisma.loyaltyAccount.deleteMany({ where: { userId: { in: userIds } } })
  await prisma.reliabilityRecord.deleteMany({ where: { userId: { in: userIds } } })
  await prisma.booking.deleteMany({ where: { shopId: { in: shopIds } } })
  await prisma.queueEntry.deleteMany({ where: { shopId: { in: shopIds } } })
  await prisma.service.deleteMany({ where: { shopId: { in: shopIds } } })
  await prisma.barber.deleteMany({ where: { shopId: { in: shopIds } } })
  await prisma.shop.deleteMany({ where: { id: { in: shopIds } } })

  await cleanupPhone(E164_ADMIN)
  await cleanupPhone(E164_OWNER)
  await cleanupPhone(E164_CUSTOMER)
}

beforeEach(cleanupAll, 30000)
afterEach(cleanupAll, 30000)

// ─── Full Booking Flow ────────────────────────────────────────────────────────

describe('S18 — Full Booking Flow', () => {
  it('book → queue done → loyalty earned → review posted', async () => {
    const owner    = await prisma.user.create({ data: { phone: E164_OWNER,    name: 'Owner',    role: 'SHOP_OWNER' } })
    const barberU  = await prisma.user.create({ data: { phone: E164_ADMIN,    name: 'Barber',   role: 'BARBER' } })
    const customer = await prisma.user.create({ data: { phone: E164_CUSTOMER, name: 'Customer', role: 'CUSTOMER' } })

    const shop = await prisma.shop.create({
      data: {
        ownerId: owner.id, nameEn: 'Flow Shop', nameAr: 'محل', address: 'St', city: 'Baghdad',
        neighborhood: 'K', neighborhoodAr: 'ك', phone: '+9640000000201',
        lat: 33.3, lng: 44.4, status: 'APPROVED', isActive: true,
        bookingMode: 'BOOKING_ONLY', plan: 'PRO',
      },
    })
    const service = await prisma.service.create({
      data: { shopId: shop.id, nameEn: 'Cut', nameAr: 'قص', price: 5000, durationMin: 30, category: 'hair' },
    })

    const customerToken = signAccess({ id: customer.id, role: 'CUSTOMER', shopId: undefined })
    const barberToken   = signAccess({ id: barberU.id,  role: 'BARBER',   shopId: undefined })

    // 1. Book
    const slot = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString()
    const bookRes = await request(app)
      .post('/api/v1/bookings')
      .set('Authorization', `Bearer ${customerToken}`)
      .send({ shopId: shop.id, serviceIds: [service.id], slot, paymentMethod: 'CASH' })

    expect(bookRes.status).toBe(201)
    const bookingId = bookRes.body.data.id

    // 2. Barber creates queue entry linked to booking
    const entry = await prisma.queueEntry.create({
      data: {
        shopId: shop.id, customerName: 'Customer',
        serviceIds: [service.id], position: 1, estimatedWait: 30,
        bookingId,
      },
    })

    // 3. Mark done
    const doneRes = await request(app)
      .patch(`/api/v1/queue/${entry.id}/done`)
      .set('Authorization', `Bearer ${barberToken}`)

    expect(doneRes.status).toBe(200)
    expect(doneRes.body.data.status).toBe('DONE')

    // 4. Booking transitions to COMPLETED
    const updatedBooking = await prisma.booking.findUnique({ where: { id: bookingId } })
    expect(updatedBooking?.status).toBe('COMPLETED')

    // 5. Loyalty points were earned
    const loyaltyTx = await prisma.loyaltyTransaction.findFirst({ where: { userId: customer.id } })
    expect(loyaltyTx).not.toBeNull()
    expect(loyaltyTx!.points).toBeGreaterThan(0)

    // 6. Customer posts a review
    const reviewRes = await request(app)
      .post('/api/v1/reviews')
      .set('Authorization', `Bearer ${customerToken}`)
      .send({ bookingId, rating: 5, comment: 'Great service!' })

    expect(reviewRes.status).toBe(201)
    expect(reviewRes.body.data.rating).toBe(5)
  })
})

// ─── No-show Flow ─────────────────────────────────────────────────────────────

describe('S18 — No-show Flow', () => {
  it('customer with score < 50 is blocked from booking', async () => {
    const owner    = await prisma.user.create({ data: { phone: E164_OWNER,    name: 'Owner',    role: 'SHOP_OWNER' } })
    const customer = await prisma.user.create({ data: { phone: E164_CUSTOMER, name: 'Customer', role: 'CUSTOMER' } })

    const shop = await prisma.shop.create({
      data: {
        ownerId: owner.id, nameEn: 'NS Shop', nameAr: 'محل', address: 'St', city: 'Baghdad',
        neighborhood: 'K', neighborhoodAr: 'ك', phone: '+9640000000201',
        lat: 33.3, lng: 44.4, status: 'APPROVED', isActive: true,
        bookingMode: 'BOOKING_ONLY', plan: 'PRO',
      },
    })
    const service = await prisma.service.create({
      data: { shopId: shop.id, nameEn: 'Cut', nameAr: 'قص', price: 5000, durationMin: 30, category: 'hair' },
    })

    // Seed low score (simulating 4 accumulated no-shows)
    await prisma.reliabilityRecord.create({
      data: { userId: customer.id, score: 30, noShowCount: 4 },
    })

    const customerToken = signAccess({ id: customer.id, role: 'CUSTOMER', shopId: undefined })
    const slot = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString()

    const res = await request(app)
      .post('/api/v1/bookings')
      .set('Authorization', `Bearer ${customerToken}`)
      .send({ shopId: shop.id, serviceIds: [service.id], slot, paymentMethod: 'CASH' })

    expect(res.status).toBe(403)
    expect(res.body.error).toBe('low_reliability')
  })
})

// ─── Suspension Flow ──────────────────────────────────────────────────────────

describe('S18 — Suspension Flow', () => {
  it('suspending a shop cancels UPCOMING bookings and notifies the customer', async () => {
    const admin    = await prisma.user.create({ data: { phone: E164_ADMIN,    name: 'Admin',    role: 'ADMIN' } })
    const owner    = await prisma.user.create({ data: { phone: E164_OWNER,    name: 'Owner',    role: 'SHOP_OWNER' } })
    const customer = await prisma.user.create({ data: { phone: E164_CUSTOMER, name: 'Customer', role: 'CUSTOMER' } })

    const shop = await prisma.shop.create({
      data: {
        ownerId: owner.id, nameEn: 'Suspend Shop', nameAr: 'محل', address: 'St', city: 'Baghdad',
        neighborhood: 'K', neighborhoodAr: 'ك', phone: '+9640000000201',
        lat: 33.3, lng: 44.4, status: 'APPROVED', isActive: true,
        bookingMode: 'BOOKING_ONLY', plan: 'PRO',
      },
    })
    const service = await prisma.service.create({
      data: { shopId: shop.id, nameEn: 'Cut', nameAr: 'قص', price: 5000, durationMin: 30, category: 'hair' },
    })

    const customerToken = signAccess({ id: customer.id, role: 'CUSTOMER', shopId: undefined })
    const adminToken    = signAccess({ id: admin.id,    role: 'ADMIN',    shopId: undefined })

    // 1. Customer books
    const slot = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString()
    const bookRes = await request(app)
      .post('/api/v1/bookings')
      .set('Authorization', `Bearer ${customerToken}`)
      .send({ shopId: shop.id, serviceIds: [service.id], slot, paymentMethod: 'CASH' })

    expect(bookRes.status).toBe(201)
    const bookingId = bookRes.body.data.id

    // 2. Admin suspends the shop
    const suspendRes = await request(app)
      .patch(`/api/v1/admin/shops/${shop.id}/suspend`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ reason: 'Policy violation' })

    expect(suspendRes.status).toBe(200)

    // 3. Shop is now suspended and inactive
    const updatedShop = await prisma.shop.findUnique({ where: { id: shop.id } })
    expect(updatedShop?.status).toBe('SUSPENDED')
    expect(updatedShop?.isActive).toBe(false)

    // 4. UPCOMING booking was cancelled with reason
    const updatedBooking = await prisma.booking.findUnique({ where: { id: bookingId } })
    expect(updatedBooking?.status).toBe('CANCELLED')
    expect(updatedBooking?.cancellationReason).toBe('shop_suspended')

    // 5. Customer received a cancellation notification
    const notification = await prisma.notification.findFirst({
      where: { userId: customer.id, type: 'CANCELLATION' },
    })
    expect(notification).not.toBeNull()
  })
})
