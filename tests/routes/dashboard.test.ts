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

const E164_OWNER    = '+9647900000123'
const E164_BARBER   = '+9647900000124'
const E164_CUSTOMER = '+9647900000125'

let ownerId:       string
let ownerToken:    string
let barberToken:   string
let customerId:    string
let shopId:        string
let barberId:      string
let serviceId:     string

beforeEach(async () => {
  await cleanupPhone(E164_OWNER)
  await cleanupPhone(E164_BARBER)
  await cleanupPhone(E164_CUSTOMER)

  const owner = await prisma.user.create({ data: { phone: E164_OWNER, name: 'Owner', role: 'SHOP_OWNER' } })
  ownerId = owner.id

  const shop = await prisma.shop.create({
    data: {
      ownerId, nameEn: 'Dash Shop', nameAr: 'محل', address: 'St', city: 'Baghdad',
      neighborhood: 'K', neighborhoodAr: 'ك', phone: '+9640000000123',
      lat: 33.34, lng: 44.40, status: 'APPROVED', isActive: true, plan: 'PRO',
    },
  })
  shopId = shop.id
  ownerToken = signAccess({ id: owner.id, role: owner.role, shopId: shop.id })

  const barberUser = await prisma.user.create({
    data: { phone: E164_BARBER, name: 'BarberUser', role: 'BARBER', shopId: shop.id },
  })
  barberToken = signAccess({ id: barberUser.id, role: barberUser.role, shopId: shop.id })

  const barber = await prisma.barber.create({
    data: { shopId: shop.id, nameEn: 'Ali', nameAr: 'علي', userId: barberUser.id },
  })
  barberId = barber.id

  const customer = await prisma.user.create({ data: { phone: E164_CUSTOMER, name: 'Customer', role: 'CUSTOMER' } })
  customerId = customer.id

  const service = await prisma.service.create({
    data: { shopId: shop.id, nameEn: 'Haircut', nameAr: 'قص', price: 5000, durationMin: 30, category: 'hair' },
  })
  serviceId = service.id
})

afterEach(async () => {
  await prisma.review.deleteMany({ where: { shopId } })
  await prisma.booking.deleteMany({ where: { shopId } })
  await prisma.queueEntry.deleteMany({ where: { shopId } })
  await prisma.shop.deleteMany({ where: { id: shopId } })
  await cleanupPhone(E164_OWNER)
  await cleanupPhone(E164_BARBER)
  await cleanupPhone(E164_CUSTOMER)
})

async function makeBooking(status: 'UPCOMING' | 'COMPLETED' | 'CANCELLED' | 'NO_SHOW', slot = new Date()) {
  return prisma.booking.create({
    data: {
      customerId, shopId, barberId, slot,
      totalPrice: 5000, depositPaid: 0,
      paymentMethod: 'ZAINCASH', status,
      services: { create: [{ serviceId, nameEn: 'Haircut', nameAr: 'قص', price: 5000, durationMin: 30 }] },
    },
  })
}

// ── GET /dashboard/stats ──────────────────────────────────────────────────────

describe('GET /api/v1/dashboard/stats', () => {
  it('returns zeroed stats when shop has no activity', async () => {
    const res = await request(app)
      .get('/api/v1/dashboard/stats')
      .set('Authorization', `Bearer ${ownerToken}`)

    expect(res.status).toBe(200)
    expect(res.body.data.todayBookings).toBe(0)
    expect(res.body.data.todayRevenue).toBe(0)
    expect(res.body.data.queueLength).toBe(0)
    expect(res.body.data.avgWaitMin).toBe(0)
  })

  it('counts only today\'s bookings and revenue from COMPLETED only', async () => {
    await makeBooking('COMPLETED')   // today, counts for revenue
    await makeBooking('UPCOMING')    // today, counts for bookings but not revenue
    await makeBooking('CANCELLED')   // today, should not count

    const res = await request(app)
      .get('/api/v1/dashboard/stats')
      .set('Authorization', `Bearer ${ownerToken}`)

    expect(res.status).toBe(200)
    expect(res.body.data.todayBookings).toBe(3)
    expect(res.body.data.todayRevenue).toBe(5000)
  })

  it('barber JWT can also access stats', async () => {
    const res = await request(app)
      .get('/api/v1/dashboard/stats')
      .set('Authorization', `Bearer ${barberToken}`)

    expect(res.status).toBe(200)
  })
})

// ── GET /dashboard/analytics ──────────────────────────────────────────────────

describe('GET /api/v1/dashboard/analytics', () => {
  it('empty range returns zeroed values not null', async () => {
    const res = await request(app)
      .get('/api/v1/dashboard/analytics?range=month')
      .set('Authorization', `Bearer ${ownerToken}`)

    expect(res.status).toBe(200)
    expect(res.body.data.totalRevenue).toBe(0)
    expect(res.body.data.totalBookings).toBe(0)
    expect(res.body.data.dailyRevenue).toEqual([])
  })

  it('revenue only counts COMPLETED bookings', async () => {
    await makeBooking('COMPLETED')
    await makeBooking('CANCELLED')
    await makeBooking('NO_SHOW')

    const res = await request(app)
      .get('/api/v1/dashboard/analytics?range=today')
      .set('Authorization', `Bearer ${ownerToken}`)

    expect(res.status).toBe(200)
    expect(res.body.data.totalRevenue).toBe(5000)
    expect(res.body.data.completedBookings).toBe(1)
    expect(res.body.data.cancelledBookings).toBe(1)
    expect(res.body.data.noShowBookings).toBe(1)
  })

  it('daily revenue breakdown groups by date', async () => {
    await makeBooking('COMPLETED')

    const res = await request(app)
      .get('/api/v1/dashboard/analytics?range=today')
      .set('Authorization', `Bearer ${ownerToken}`)

    expect(res.body.data.dailyRevenue).toHaveLength(1)
    expect(res.body.data.dailyRevenue[0].revenue).toBe(5000)
    expect(res.body.data.dailyRevenue[0].bookings).toBe(1)
  })
})

// ── GET /dashboard/analytics/barbers ─────────────────────────────────────────

describe('GET /api/v1/dashboard/analytics/barbers', () => {
  it('owner gets per-barber breakdown', async () => {
    await makeBooking('COMPLETED')

    const res = await request(app)
      .get('/api/v1/dashboard/analytics/barbers')
      .set('Authorization', `Bearer ${ownerToken}`)

    expect(res.status).toBe(200)
    expect(Array.isArray(res.body.data)).toBe(true)
    const barberRow = res.body.data.find((b: { barberId: string }) => b.barberId === barberId)
    expect(barberRow.totalBookings).toBe(1)
    expect(barberRow.totalRevenue).toBe(5000)
  })

  it('returns 403 for barber role', async () => {
    const res = await request(app)
      .get('/api/v1/dashboard/analytics/barbers')
      .set('Authorization', `Bearer ${barberToken}`)

    expect(res.status).toBe(403)
  })
})

// ── POST /dashboard/walk-in-sale ──────────────────────────────────────────────

describe('POST /api/v1/dashboard/walk-in-sale', () => {
  it('creates a COMPLETED booking with paymentMethod CASH', async () => {
    const res = await request(app)
      .post('/api/v1/dashboard/walk-in-sale')
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({ serviceIds: [serviceId], barberId, totalPrice: 7000 })

    expect(res.status).toBe(201)
    expect(res.body.data.status).toBe('COMPLETED')
    expect(res.body.data.paymentMethod).toBe('CASH')
    expect(res.body.data.totalPrice).toBe(7000)
  })

  it('walk-in sale appears immediately in revenue stats', async () => {
    await request(app)
      .post('/api/v1/dashboard/walk-in-sale')
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({ serviceIds: [serviceId], totalPrice: 7000 })

    const stats = await request(app)
      .get('/api/v1/dashboard/stats')
      .set('Authorization', `Bearer ${ownerToken}`)

    expect(stats.body.data.todayRevenue).toBe(7000)
  })

  it('returns 400 when serviceIds is empty', async () => {
    const res = await request(app)
      .post('/api/v1/dashboard/walk-in-sale')
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({ serviceIds: [], totalPrice: 5000 })

    expect(res.status).toBe(400)
  })

  it('returns 404 when service does not belong to the shop', async () => {
    const res = await request(app)
      .post('/api/v1/dashboard/walk-in-sale')
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({ serviceIds: ['cmfake00000000000000000000'], totalPrice: 5000 })

    expect(res.status).toBe(404)
  })
})
