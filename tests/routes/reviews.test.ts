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

const E164_OWNER    = '+9647900000110'
const E164_CUSTOMER = '+9647900000111'
const E164_OTHER    = '+9647900000112'
const E164_ADMIN    = '+9647900000113'

const BASE_SHOP = {
  nameEn: 'Review Shop', nameAr: 'محل',
  address: 'St', city: 'Baghdad',
  neighborhood: 'K', neighborhoodAr: 'ك',
  phone: '+9640000000110', lat: 33.34, lng: 44.40,
  status: 'APPROVED' as const, isActive: true,
}

let ownerId: string
let ownerToken: string
let customerId: string
let customerToken: string
let otherToken: string
let adminToken: string
let shopId: string
let bookingId: string

beforeEach(async () => {
  // Pre-clean: handles leftover data if a previous run failed mid-way
  await cleanupPhone(E164_OWNER)
  await cleanupPhone(E164_CUSTOMER)
  await cleanupPhone(E164_OTHER)
  await cleanupPhone(E164_ADMIN)

  const owner = await prisma.user.create({ data: { phone: E164_OWNER, name: 'Owner', role: 'SHOP_OWNER' } })
  ownerId = owner.id
  ownerToken = signAccess({ id: owner.id, role: owner.role })

  const customer = await prisma.user.create({ data: { phone: E164_CUSTOMER, name: 'Customer', role: 'CUSTOMER' } })
  customerId = customer.id
  customerToken = signAccess({ id: customer.id, role: customer.role })

  const other = await prisma.user.create({ data: { phone: E164_OTHER, name: 'Other', role: 'SHOP_OWNER' } })
  otherToken = signAccess({ id: other.id, role: other.role })

  const admin = await prisma.user.create({ data: { phone: E164_ADMIN, name: 'Admin', role: 'ADMIN' } })
  adminToken = signAccess({ id: admin.id, role: admin.role })

  const shop = await prisma.shop.create({ data: { ...BASE_SHOP, ownerId } })
  shopId = shop.id

  const booking = await prisma.booking.create({
    data: {
      customerId,
      shopId,
      slot:          new Date('2025-01-01T10:00:00Z'),
      totalPrice:    5000,
      depositPaid:   1000,
      paymentMethod: 'ZAINCASH',
    },
  })
  bookingId = booking.id
})

afterEach(async () => {
  // Reviews reference Booking; Booking has no cascade from Shop — delete in order
  await prisma.review.deleteMany({ where: { shopId } })
  await prisma.booking.deleteMany({ where: { shopId } })
  await prisma.shop.deleteMany({ where: { ownerId } })
  await cleanupPhone(E164_OWNER)
  await cleanupPhone(E164_CUSTOMER)
  await cleanupPhone(E164_OTHER)
  await cleanupPhone(E164_ADMIN)
})

describe('GET /api/v1/shops/:id/reviews', () => {
  it('returns only visible reviews for public', async () => {
    await prisma.review.create({
      data: { bookingId, customerId, shopId, rating: 5, comment: 'Great!', isVisible: true },
    })
    await prisma.review.create({
      data: {
        bookingId: (await prisma.booking.create({
          data: { customerId, shopId, slot: new Date('2025-02-01T10:00:00Z'), totalPrice: 5000, depositPaid: 1000, paymentMethod: 'ZAINCASH' },
        })).id,
        customerId, shopId, rating: 1, comment: 'Bad', isVisible: false,
      },
    })

    const res = await request(app).get(`/api/v1/shops/${shopId}/reviews`)

    expect(res.status).toBe(200)
    expect(res.body.data.reviews.length).toBe(1)
    expect(res.body.data.reviews[0].comment).toBe('Great!')
  })
})

describe('POST /api/v1/reviews', () => {
  it('creates a review and returns 201', async () => {
    const res = await request(app)
      .post('/api/v1/reviews')
      .set('Authorization', `Bearer ${customerToken}`)
      .send({ bookingId, rating: 5, comment: 'Excellent service!' })

    expect(res.status).toBe(201)
    expect(res.body.data.rating).toBe(5)
    expect(res.body.data.shopId).toBe(shopId)
  })

  it('sets booking.hasReview = true after review', async () => {
    await request(app)
      .post('/api/v1/reviews')
      .set('Authorization', `Bearer ${customerToken}`)
      .send({ bookingId, rating: 4, comment: 'Very good!' })

    const booking = await prisma.booking.findUnique({ where: { id: bookingId } })
    expect(booking!.hasReview).toBe(true)
  })

  it('returns 409 when booking already has a review', async () => {
    await request(app)
      .post('/api/v1/reviews')
      .set('Authorization', `Bearer ${customerToken}`)
      .send({ bookingId, rating: 5, comment: 'First review' })

    const res = await request(app)
      .post('/api/v1/reviews')
      .set('Authorization', `Bearer ${customerToken}`)
      .send({ bookingId, rating: 3, comment: 'Second review attempt' })

    expect(res.status).toBe(409)
  })

  it('returns 403 when customer does not own the booking', async () => {
    const res = await request(app)
      .post('/api/v1/reviews')
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({ bookingId, rating: 5, comment: 'Not my booking' })

    expect(res.status).toBe(403)
  })
})

describe('Flag lifecycle — POST flag → PATCH resolve', () => {
  let reviewId: string

  beforeEach(async () => {
    const review = await prisma.review.create({
      data: { bookingId, customerId, shopId, rating: 1, comment: 'Terrible' },
    })
    reviewId = review.id
  })

  it('owner can flag a review (flagStatus = PENDING)', async () => {
    const res = await request(app)
      .post(`/api/v1/reviews/${reviewId}/flag`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({ reason: 'SPAM' })

    expect(res.status).toBe(200)
    expect(res.body.data.flagStatus).toBe('PENDING')
  })

  it('returns 403 when a different shop owner tries to flag', async () => {
    const res = await request(app)
      .post(`/api/v1/reviews/${reviewId}/flag`)
      .set('Authorization', `Bearer ${otherToken}`)
      .send({ reason: 'FAKE' })

    expect(res.status).toBe(403)
  })

  it('admin can remove a flagged review (isVisible = false)', async () => {
    await request(app)
      .post(`/api/v1/reviews/${reviewId}/flag`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({ reason: 'INAPPROPRIATE' })

    const res = await request(app)
      .patch(`/api/v1/reviews/${reviewId}/flag`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ action: 'remove', removalReason: 'Confirmed inappropriate' })

    expect(res.status).toBe(200)
    const updated = await prisma.review.findUnique({ where: { id: reviewId } })
    expect(updated!.isVisible).toBe(false)
    expect(updated!.flagStatus).toBe('REMOVED')
  })

  it('admin can approve a flagged review (stays visible)', async () => {
    await request(app)
      .post(`/api/v1/reviews/${reviewId}/flag`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({ reason: 'SPAM' })

    const res = await request(app)
      .patch(`/api/v1/reviews/${reviewId}/flag`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ action: 'approve' })

    expect(res.status).toBe(200)
    const updated = await prisma.review.findUnique({ where: { id: reviewId } })
    expect(updated!.isVisible).toBe(true)
    expect(updated!.flagStatus).toBe('APPROVED')
  })
})
