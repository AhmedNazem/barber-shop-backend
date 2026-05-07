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

const CUSTOMER_PHONES = Array.from({ length: 10 }, (_, i) =>
  `+96479000001${(47 + i).toString().padStart(2, '0')}`
)
const OWNER_PHONE = '+9647900000157'

let shopId: string
let serviceId: string
let customerTokens: string[]

beforeEach(async () => {
  await cleanupPhone(OWNER_PHONE)
  for (const phone of CUSTOMER_PHONES) await cleanupPhone(phone)

  const owner = await prisma.user.create({ data: { phone: OWNER_PHONE, name: 'Race Owner', role: 'SHOP_OWNER' } })

  const shop = await prisma.shop.create({
    data: {
      ownerId: owner.id, nameEn: 'Race Shop', nameAr: 'محل', address: 'St', city: 'Baghdad',
      neighborhood: 'K', neighborhoodAr: 'ك', phone: '+9640000000157',
      lat: 33.34, lng: 44.40, status: 'APPROVED', isActive: true,
      plan: 'PRO', bookingMode: 'BOOKING_ONLY', depositRequired: false,
    },
  })
  shopId = shop.id

  const service = await prisma.service.create({
    data: { shopId, nameEn: 'Cut', nameAr: 'قص', price: 5000, durationMin: 30, category: 'hair' },
  })
  serviceId = service.id

  await prisma.shopDiscount.create({
    data: { shopId, pct: 20, maxUsers: 3, expiresAt: new Date(Date.now() + 86400000) },
  })

  customerTokens = await Promise.all(
    CUSTOMER_PHONES.map(async (phone, i) => {
      const user = await prisma.user.create({ data: { phone, name: `Cust${i}`, role: 'CUSTOMER' } })
      return signAccess({ id: user.id, role: 'CUSTOMER', shopId: undefined })
    }),
  )
}, 60000)

afterEach(async () => {
  await prisma.bookingService.deleteMany({ where: { booking: { shopId } } })
  await prisma.booking.deleteMany({ where: { shopId } })
  await prisma.shopDiscount.deleteMany({ where: { shopId } })
  await prisma.service.deleteMany({ where: { shopId } })
  await prisma.shop.deleteMany({ where: { id: shopId } })
  await cleanupPhone(OWNER_PHONE)
  for (const phone of CUSTOMER_PHONES) await cleanupPhone(phone)
}, 60000)

describe('Discount race condition — only maxUsers slots claimed', () => {
  it('10 concurrent requests with maxUsers:3 — slotsClaimed never exceeds 3', async () => {
    const baseTime = new Date('2026-12-01T09:00:00.000Z').getTime()

    const results = await Promise.allSettled(
      customerTokens.map((token, i) =>
        request(app)
          .post('/api/v1/bookings')
          .set('Authorization', `Bearer ${token}`)
          .send({
            shopId,
            serviceIds:    [serviceId],
            slot:          new Date(baseTime + i * 2 * 60 * 60 * 1000).toISOString(),
            paymentMethod: 'CASH',
          }),
      ),
    )

    const statuses: number[] = []
    for (const r of results) {
      if (r.status === 'fulfilled') statuses.push(r.value.status)
    }

    expect(statuses).not.toHaveLength(0)

    const discount = await prisma.shopDiscount.findUnique({ where: { shopId } })
    expect(discount!.slotsClaimed).toBeLessThanOrEqual(3)

    const bookings = await prisma.booking.findMany({ where: { shopId } })
    const discounted = bookings.filter((b) => b.discountPct !== null)
    expect(discounted.length).toBeLessThanOrEqual(3)

    const succeeded = statuses.filter((s) => s === 201).length
    if (succeeded === 10) {
      expect(discounted.length).toBe(3)
    }
  }, 90000)
})
