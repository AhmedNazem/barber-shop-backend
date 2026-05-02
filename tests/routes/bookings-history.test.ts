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

vi.mock('@/lib/s3', () => ({
  uploadToS3: vi.fn().mockResolvedValue('https://fake-s3.local/reviews/test.jpg'),
}))

const app = createApp({ NODE_ENV: 'test', CORS_ORIGIN: 'http://localhost:3000' })

const E164_OWNER    = '+9647900000120'
const E164_CUSTOMER = '+9647900000121'
const E164_OTHER    = '+9647900000122'

let ownerId:       string
let ownerToken:    string
let customerId:    string
let customerToken: string
let otherToken:    string
let shopId:        string
let serviceId:     string

beforeEach(async () => {
  await cleanupPhone(E164_OWNER)
  await cleanupPhone(E164_CUSTOMER)
  await cleanupPhone(E164_OTHER)

  const owner = await prisma.user.create({ data: { phone: E164_OWNER, name: 'Owner', role: 'SHOP_OWNER' } })
  ownerId = owner.id
  ownerToken = signAccess({ id: owner.id, role: owner.role })

  const customer = await prisma.user.create({ data: { phone: E164_CUSTOMER, name: 'Customer', role: 'CUSTOMER' } })
  customerId = customer.id
  customerToken = signAccess({ id: customer.id, role: customer.role })

  const other = await prisma.user.create({ data: { phone: E164_OTHER, name: 'Other', role: 'CUSTOMER' } })
  otherToken = signAccess({ id: other.id, role: other.role })

  const shop = await prisma.shop.create({
    data: {
      ownerId, nameEn: 'History Shop', nameAr: 'محل', address: 'St', city: 'Baghdad',
      neighborhood: 'K', neighborhoodAr: 'ك', phone: '+9640000000120',
      lat: 33.34, lng: 44.40, status: 'APPROVED', isActive: true,
    },
  })
  shopId = shop.id

  const service = await prisma.service.create({
    data: { shopId, nameEn: 'Cut', nameAr: 'قص', price: 5000, durationMin: 30, category: 'hair' },
  })
  serviceId = service.id
})

afterEach(async () => {
  await prisma.review.deleteMany({ where: { shopId } })
  await prisma.booking.deleteMany({ where: { shopId } })
  await prisma.reliabilityRecord.deleteMany({ where: { userId: customerId } })
  await prisma.shop.deleteMany({ where: { ownerId } })
  await cleanupPhone(E164_OWNER)
  await cleanupPhone(E164_CUSTOMER)
  await cleanupPhone(E164_OTHER)
})

async function makeBooking(slot: Date, status = 'UPCOMING' as const) {
  return prisma.booking.create({
    data: {
      customerId, shopId, slot,
      totalPrice: 5000, depositPaid: 0,
      paymentMethod: 'ZAINCASH', status,
      services: { create: [{ serviceId, nameEn: 'Cut', nameAr: 'قص', price: 5000, durationMin: 30 }] },
    },
  })
}

// ── GET /bookings ──────────────────────────────────────────────────────────────

describe('GET /api/v1/bookings', () => {
  it('returns empty array when customer has no bookings', async () => {
    const res = await request(app)
      .get('/api/v1/bookings')
      .set('Authorization', `Bearer ${customerToken}`)

    expect(res.status).toBe(200)
    expect(res.body.data).toEqual([])
  })

  it('returns bookings sorted by slot descending', async () => {
    await makeBooking(new Date('2025-12-10T10:00:00Z'))
    await makeBooking(new Date('2025-12-15T10:00:00Z'))

    const res = await request(app)
      .get('/api/v1/bookings')
      .set('Authorization', `Bearer ${customerToken}`)

    expect(res.status).toBe(200)
    expect(res.body.data).toHaveLength(2)
    expect(new Date(res.body.data[0].slot) > new Date(res.body.data[1].slot)).toBe(true)
  })
})

// ── GET /bookings/:id ──────────────────────────────────────────────────────────

describe('GET /api/v1/bookings/:id', () => {
  it('returns the booking with services included', async () => {
    const booking = await makeBooking(new Date('2025-12-15T10:00:00Z'))

    const res = await request(app)
      .get(`/api/v1/bookings/${booking.id}`)
      .set('Authorization', `Bearer ${customerToken}`)

    expect(res.status).toBe(200)
    expect(res.body.data.id).toBe(booking.id)
    expect(res.body.data.services).toHaveLength(1)
  })

  it('returns 404 for unknown booking', async () => {
    const res = await request(app)
      .get('/api/v1/bookings/nonexistent-id')
      .set('Authorization', `Bearer ${customerToken}`)

    expect(res.status).toBe(404)
  })

  it('returns 403 when another customer tries to access the booking', async () => {
    const booking = await makeBooking(new Date('2025-12-15T10:00:00Z'))

    const res = await request(app)
      .get(`/api/v1/bookings/${booking.id}`)
      .set('Authorization', `Bearer ${otherToken}`)

    expect(res.status).toBe(403)
  })
})

// ── PATCH /bookings/:id/cancel ─────────────────────────────────────────────────

describe('PATCH /api/v1/bookings/:id/cancel', () => {
  it('cancels a booking with slot well in the future', async () => {
    const slot = new Date(Date.now() + 24 * 60 * 60 * 1000) // 24h from now
    const booking = await makeBooking(slot)

    const res = await request(app)
      .patch(`/api/v1/bookings/${booking.id}/cancel`)
      .set('Authorization', `Bearer ${customerToken}`)

    expect(res.status).toBe(200)
    expect(res.body.data.cancelled).toBe(true)

    const updated = await prisma.booking.findUnique({ where: { id: booking.id } })
    expect(updated?.status).toBe('CANCELLED')
  })

  it('cancels within 2h window (late cancel) and deducts reliability −10', async () => {
    const slot = new Date(Date.now() + 30 * 60 * 1000) // 30 min from now — inside 2h window
    const booking = await makeBooking(slot)

    const res = await request(app)
      .patch(`/api/v1/bookings/${booking.id}/cancel`)
      .set('Authorization', `Bearer ${customerToken}`)

    expect(res.status).toBe(200)

    const reliability = await prisma.reliabilityRecord.findUnique({ where: { userId: customerId } })
    expect(reliability?.score).toBe(90)
  })

  it('returns 422 when booking is already cancelled', async () => {
    const slot = new Date(Date.now() + 24 * 60 * 60 * 1000)
    const booking = await makeBooking(slot, 'CANCELLED')

    const res = await request(app)
      .patch(`/api/v1/bookings/${booking.id}/cancel`)
      .set('Authorization', `Bearer ${customerToken}`)

    expect(res.status).toBe(422)
  })

  it('returns 403 when another customer tries to cancel', async () => {
    const slot = new Date(Date.now() + 24 * 60 * 60 * 1000)
    const booking = await makeBooking(slot)

    const res = await request(app)
      .patch(`/api/v1/bookings/${booking.id}/cancel`)
      .set('Authorization', `Bearer ${otherToken}`)

    expect(res.status).toBe(403)
  })
})

// ── POST /reviews ──────────────────────────────────────────────────────────────

describe('POST /api/v1/reviews', () => {
  it('creates a review and marks booking hasReview = true', async () => {
    const booking = await makeBooking(new Date('2025-11-01T10:00:00Z'), 'COMPLETED')

    const res = await request(app)
      .post('/api/v1/reviews')
      .set('Authorization', `Bearer ${customerToken}`)
      .field('bookingId', booking.id)
      .field('rating', '5')
      .field('comment', 'Excellent service!')

    expect(res.status).toBe(201)
    expect(res.body.data.rating).toBe(5)

    const updated = await prisma.booking.findUnique({ where: { id: booking.id } })
    expect(updated?.hasReview).toBe(true)
  })

  it('returns 409 when booking already has a review', async () => {
    const booking = await makeBooking(new Date('2025-11-01T10:00:00Z'), 'COMPLETED')
    await prisma.booking.update({ where: { id: booking.id }, data: { hasReview: true } })
    await prisma.review.create({
      data: { bookingId: booking.id, customerId, shopId, rating: 4, comment: 'Good' },
    })

    const res = await request(app)
      .post('/api/v1/reviews')
      .set('Authorization', `Bearer ${customerToken}`)
      .field('bookingId', booking.id)
      .field('rating', '5')
      .field('comment', 'Trying again!')

    expect(res.status).toBe(409)
  })

  it('returns 403 when customer does not own the booking', async () => {
    const booking = await makeBooking(new Date('2025-11-01T10:00:00Z'), 'COMPLETED')

    const res = await request(app)
      .post('/api/v1/reviews')
      .set('Authorization', `Bearer ${otherToken}`)
      .field('bookingId', booking.id)
      .field('rating', '5')
      .field('comment', 'Not my booking!')

    expect(res.status).toBe(403)
  })
})

// ── POST /reviews/:id/flag ─────────────────────────────────────────────────────

describe('POST /api/v1/reviews/:reviewId/flag', () => {
  async function makeReview() {
    const booking = await makeBooking(new Date('2025-11-01T10:00:00Z'), 'COMPLETED')
    return prisma.review.create({
      data: { bookingId: booking.id, customerId, shopId, rating: 1, comment: 'Bad review' },
    })
  }

  it('owner can flag a review on their shop', async () => {
    const review = await makeReview()

    const res = await request(app)
      .post(`/api/v1/reviews/${review.id}/flag`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({ reason: 'SPAM' })

    expect(res.status).toBe(200)
    expect(res.body.data.flagStatus).toBe('PENDING')
  })

  it('returns 403 when a different owner tries to flag', async () => {
    const review = await makeReview()
    const otherOwner = await prisma.user.create({
      data: { phone: '+9647900000199', name: 'Other Owner', role: 'SHOP_OWNER' },
    })
    const otherOwnerToken = signAccess({ id: otherOwner.id, role: otherOwner.role })

    const res = await request(app)
      .post(`/api/v1/reviews/${review.id}/flag`)
      .set('Authorization', `Bearer ${otherOwnerToken}`)
      .send({ reason: 'SPAM' })

    expect(res.status).toBe(403)

    await prisma.user.delete({ where: { id: otherOwner.id } })
  })
})

// ── PATCH /reviews/:id/flag (admin resolves) ──────────────────────────────────

describe('PATCH /api/v1/reviews/:reviewId/flag', () => {
  async function makeFlaggedReview() {
    const booking = await makeBooking(new Date('2025-11-01T10:00:00Z'), 'COMPLETED')
    return prisma.review.create({
      data: {
        bookingId: booking.id, customerId, shopId,
        rating: 1, comment: 'Bad',
        flagStatus: 'PENDING', flagReason: 'SPAM',
        flaggedBy: ownerId, flaggedAt: new Date(),
      },
    })
  }

  it('admin can approve a flagged review (keeps visible)', async () => {
    const review = await makeFlaggedReview()
    const admin = await prisma.user.create({ data: { phone: '+9647900000198', name: 'Admin', role: 'ADMIN' } })
    const adminToken = signAccess({ id: admin.id, role: admin.role })

    const res = await request(app)
      .patch(`/api/v1/reviews/${review.id}/flag`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ action: 'approve' })

    expect(res.status).toBe(200)
    expect(res.body.data.flagStatus).toBe('APPROVED')
    expect(res.body.data.isVisible).toBe(true)

    await prisma.user.delete({ where: { id: admin.id } })
  })

  it('admin can remove a flagged review (hides it)', async () => {
    const review = await makeFlaggedReview()
    const admin = await prisma.user.create({ data: { phone: '+9647900000197', name: 'Admin2', role: 'ADMIN' } })
    const adminToken = signAccess({ id: admin.id, role: admin.role })

    const res = await request(app)
      .patch(`/api/v1/reviews/${review.id}/flag`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ action: 'remove', removalReason: 'Verified spam' })

    expect(res.status).toBe(200)
    expect(res.body.data.flagStatus).toBe('REMOVED')
    expect(res.body.data.isVisible).toBe(false)

    await prisma.user.delete({ where: { id: admin.id } })
  })
})
