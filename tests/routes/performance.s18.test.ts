import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest'
import request from 'supertest'
import { createApp } from '@/app'
import { prisma } from '@/config/prisma'
import { signAccess } from '@/lib/jwt'
import { redisClient } from '@/lib/redis'
import { cleanupPhone } from '../helpers/auth'

vi.mock('@/lib/sms', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/sms')>()
  return { ...actual, sendSms: vi.fn().mockResolvedValue(undefined) }
})

const app = createApp({ NODE_ENV: 'test', CORS_ORIGIN: 'http://localhost:3000' })

const E164_OWNER    = '+9647900000203'
const E164_CUSTOMER = '+9647900000204'

// Generous per-request threshold for remote Neon test DB
// Production target (local DB): /shops <200ms, /availability <100ms, /bookings <500ms
const P_SHOPS_MS    = 5_000
const P_AVAIL_MS    = 3_000
const P_BOOKINGS_MS = 5_000

let shopId:        string
let barberId:      string
let serviceId:     string
let customerToken: string

async function cleanupAll() {
  const users = await prisma.user.findMany({
    where:  { phone: { in: [E164_OWNER, E164_CUSTOMER] } },
    select: { id: true },
  })
  const userIds = users.map(u => u.id)

  const shops = await prisma.shop.findMany({
    where:  { ownerId: { in: userIds } },
    select: { id: true },
  })
  const shopIds = shops.map(s => s.id)

  if (shopIds.length) {
    const queueKeys  = shopIds.map(id => `shop:queue:${id}`)
    const ratingKeys = shopIds.map(id => `shop:rating:${id}`)
    await redisClient.del(...queueKeys)
    await redisClient.del(...ratingKeys)
  }

  await prisma.booking.deleteMany({ where: { shopId: { in: shopIds } } })
  await prisma.barberSchedule.deleteMany({ where: { barber: { shopId: { in: shopIds } } } })
  await prisma.barber.deleteMany({ where: { shopId: { in: shopIds } } })
  await prisma.service.deleteMany({ where: { shopId: { in: shopIds } } })
  await prisma.shop.deleteMany({ where: { id: { in: shopIds } } })
  await cleanupPhone(E164_OWNER)
  await cleanupPhone(E164_CUSTOMER)
}

beforeAll(async () => {
  await cleanupAll()

  const owner    = await prisma.user.create({ data: { phone: E164_OWNER,    name: 'PerfOwner',    role: 'SHOP_OWNER' } })
  const customer = await prisma.user.create({ data: { phone: E164_CUSTOMER, name: 'PerfCustomer', role: 'CUSTOMER' } })

  customerToken = signAccess({ id: customer.id, role: 'CUSTOMER', shopId: undefined })

  // Bulk-create 100 shops (limit is capped at 50 in controller, but seeds 100 for total realism)
  await prisma.shop.createMany({
    data: Array.from({ length: 100 }, (_, i) => ({
      ownerId:        owner.id,
      nameEn:         `Perf Shop ${i}`,
      nameAr:         `محل ${i}`,
      address:        `Street ${i}`,
      city:           'Baghdad',
      neighborhood:   'K',
      neighborhoodAr: 'ك',
      phone:          '+9640000000203',
      lat:            33.3 + i * 0.001,
      lng:            44.4 + i * 0.001,
      status:         'APPROVED',
      isActive:       true,
      plan:           'PRO',
      bookingMode:    'BOOKING_ONLY',
    })),
  })

  // Pick the first shop for detail/availability/booking tests
  const firstShop = await prisma.shop.findFirst({ where: { ownerId: owner.id }, orderBy: { createdAt: 'asc' } })
  shopId = firstShop!.id

  const service = await prisma.service.create({
    data: { shopId, nameEn: 'Cut', nameAr: 'قص', price: 5000, durationMin: 30, category: 'hair' },
  })
  serviceId = service.id

  const barber = await prisma.barber.create({ data: { shopId, nameEn: 'Ali', nameAr: 'علي' } })
  barberId = barber.id

  // Schedule covers all days so the availability date always hits a valid slot
  await prisma.barberSchedule.createMany({
    data: [0, 1, 2, 3, 4, 5, 6].map(day => ({
      barberId, dayOfWeek: day, startTime: '09:00', endTime: '17:00', isAvailable: true,
    })),
  })

  // Warmup request to populate Redis rating cache (avoids N×aggregate on first timed request)
  await request(app).get('/api/v1/shops?limit=50&offset=0')
}, 120_000)

afterAll(cleanupAll, 60_000)

// ─── GET /shops performance ───────────────────────────────────────────────────

describe('Performance — GET /shops (100 shops seeded, warm cache)', () => {
  it(`p99 of 5 warm requests is under ${P_SHOPS_MS}ms`, async () => {
    const times: number[] = []

    for (let i = 0; i < 5; i++) {
      const start = Date.now()
      const res   = await request(app).get('/api/v1/shops?limit=50&offset=0')
      times.push(Date.now() - start)

      expect(res.status).toBe(200)
      expect(Array.isArray(res.body.data)).toBe(true)
      expect(res.body.data.length).toBeGreaterThan(0)
    }

    const sorted = [...times].sort((a, b) => a - b)
    const p99    = sorted[Math.ceil(sorted.length * 0.99) - 1]!
    expect(p99).toBeLessThan(P_SHOPS_MS)
  }, 60_000)

  it('queue count Redis cache is populated after first request', async () => {
    await request(app).get('/api/v1/shops?limit=10&offset=0')

    // Verify cache key exists in Redis for the test shop
    const cached = await redisClient.get(`shop:queue:${shopId}`)
    expect(cached).not.toBeNull()
  }, 30_000)
})

// ─── GET /shops/:id/availability performance ──────────────────────────────────

describe('Performance — GET /shops/:id/availability', () => {
  it(`p99 of 5 requests is under ${P_AVAIL_MS}ms`, async () => {
    // Use tomorrow — always within the 3-day REGULAR_DAYS_AHEAD limit
    const tomorrow = new Date(Date.now() + 24 * 60 * 60 * 1000)
    const dateStr  = tomorrow.toISOString().split('T')[0]

    const times: number[] = []

    for (let i = 0; i < 5; i++) {
      const start = Date.now()
      const res   = await request(app)
        .get(`/api/v1/shops/${shopId}/availability?date=${dateStr}&barberId=${barberId}`)
      times.push(Date.now() - start)

      expect(res.status).toBe(200)
    }

    const sorted = [...times].sort((a, b) => a - b)
    const p99    = sorted[Math.ceil(sorted.length * 0.99) - 1]!
    expect(p99).toBeLessThan(P_AVAIL_MS)
  }, 60_000)
})

// ─── POST /bookings performance ───────────────────────────────────────────────

describe('Performance — POST /bookings', () => {
  it(`p99 of 3 booking creations is under ${P_BOOKINGS_MS}ms`, async () => {
    // Slots well in the future so no conflict and no date-too-soon validation
    const baseSlot = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000)
    baseSlot.setUTCHours(10, 0, 0, 0)

    const times: number[] = []

    for (let i = 0; i < 3; i++) {
      const slot  = new Date(baseSlot.getTime() + i * 60 * 60 * 1000).toISOString()
      const start = Date.now()
      const res   = await request(app)
        .post('/api/v1/bookings')
        .set('Authorization', `Bearer ${customerToken}`)
        .send({ shopId, serviceIds: [serviceId], slot, paymentMethod: 'CASH' })
      times.push(Date.now() - start)

      expect(res.status).toBe(201)
    }

    const sorted = [...times].sort((a, b) => a - b)
    const p99    = sorted[Math.ceil(sorted.length * 0.99) - 1]!
    expect(p99).toBeLessThan(P_BOOKINGS_MS)
  }, 60_000)
})
