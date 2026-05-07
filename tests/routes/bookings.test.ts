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

const E164_OWNER    = '+9647900000114'
const E164_CUSTOMER = '+9647900000115'
const E164_OTHER    = '+9647900000116'

const BASE_SHOP = {
  nameEn: 'Booking Shop', nameAr: 'محل',
  address: 'St', city: 'Baghdad',
  neighborhood: 'K', neighborhoodAr: 'ك',
  phone: '+9640000000114', lat: 33.34, lng: 44.40,
  status: 'APPROVED' as const, isActive: true,
  plan: 'PRO' as const,
  bookingMode: 'BOOKING_ONLY' as const,
  depositRequired: true, depositPercent: 20,
}

const SLOT = '2025-12-15T10:00:00.000Z'

let ownerId: string
let customerId: string
let customerToken: string
let otherToken: string
let shopId: string
let barberId: string
let serviceId: string

beforeEach(async () => {
  await cleanupPhone(E164_OWNER)
  await cleanupPhone(E164_CUSTOMER)
  await cleanupPhone(E164_OTHER)

  const owner    = await prisma.user.create({ data: { phone: E164_OWNER,    name: 'Owner',    role: 'SHOP_OWNER' } })
  ownerId = owner.id

  const customer = await prisma.user.create({ data: { phone: E164_CUSTOMER, name: 'Customer', role: 'CUSTOMER' } })
  customerId = customer.id
  customerToken = signAccess({ id: customer.id, role: customer.role })

  const other    = await prisma.user.create({ data: { phone: E164_OTHER,    name: 'Other',    role: 'CUSTOMER' } })
  otherToken = signAccess({ id: other.id, role: other.role })

  const shop    = await prisma.shop.create({ data: { ...BASE_SHOP, ownerId } })
  shopId = shop.id

  const barber  = await prisma.barber.create({ data: { shopId, nameEn: 'Ali', nameAr: 'علي' } })
  barberId = barber.id

  await prisma.barberSchedule.create({
    data: { barberId, dayOfWeek: 1, startTime: '09:00', endTime: '17:00', isAvailable: true },
  })

  const service = await prisma.service.create({
    data: { shopId, nameEn: 'Haircut', nameAr: 'قص', price: 5000, durationMin: 30, category: 'hair' },
  })
  serviceId = service.id
})

afterEach(async () => {
  await prisma.booking.deleteMany({ where: { shopId } })
  await prisma.shop.deleteMany({ where: { ownerId } })
  await cleanupPhone(E164_OWNER)
  await cleanupPhone(E164_CUSTOMER)
  await cleanupPhone(E164_OTHER)
})

describe('POST /api/v1/bookings', () => {
  it('creates a booking and returns 201', async () => {
    const res = await request(app)
      .post('/api/v1/bookings')
      .set('Authorization', `Bearer ${customerToken}`)
      .send({ shopId, barberId, serviceIds: [serviceId], slot: SLOT, paymentMethod: 'ZAINCASH' })

    expect(res.status).toBe(201)
    expect(res.body.data.shopId).toBe(shopId)
    expect(res.body.data.totalPrice).toBe(5000)
  })

  it('snapshots service data into BookingService rows', async () => {
    const res = await request(app)
      .post('/api/v1/bookings')
      .set('Authorization', `Bearer ${customerToken}`)
      .send({ shopId, barberId, serviceIds: [serviceId], slot: SLOT, paymentMethod: 'ZAINCASH' })

    expect(res.body.data.services[0].nameEn).toBe('Haircut')
    expect(res.body.data.services[0].price).toBe(5000)
    expect(res.body.data.services[0].durationMin).toBe(30)
  })

  it('calculates deposit correctly (nearest 250 IQD)', async () => {
    const res = await request(app)
      .post('/api/v1/bookings')
      .set('Authorization', `Bearer ${customerToken}`)
      .send({ shopId, barberId, serviceIds: [serviceId], slot: SLOT, paymentMethod: 'ZAINCASH' })

    // 5000 * 20% = 1000 → round(1000/250)*250 = 1000
    expect(res.body.data.depositPaid).toBe(1000)
  })

  it('returns 409 when slot is already taken', async () => {
    await request(app)
      .post('/api/v1/bookings')
      .set('Authorization', `Bearer ${customerToken}`)
      .send({ shopId, barberId, serviceIds: [serviceId], slot: SLOT, paymentMethod: 'ZAINCASH' })

    const res = await request(app)
      .post('/api/v1/bookings')
      .set('Authorization', `Bearer ${otherToken}`)
      .send({ shopId, barberId, serviceIds: [serviceId], slot: SLOT, paymentMethod: 'ZAINCASH' })

    expect(res.status).toBe(409)
  })

  it('returns 404 when service does not belong to the shop', async () => {
    const otherShop = await prisma.shop.create({
      data: { ...BASE_SHOP, phone: '+9640000000199', ownerId, nameEn: 'Other Shop', nameAr: 'محل آخر' },
    })
    const foreignService = await prisma.service.create({
      data: { shopId: otherShop.id, nameEn: 'Cut', nameAr: 'قص', price: 3000, durationMin: 30, category: 'hair' },
    })

    const res = await request(app)
      .post('/api/v1/bookings')
      .set('Authorization', `Bearer ${customerToken}`)
      .send({ shopId, barberId, serviceIds: [foreignService.id], slot: SLOT, paymentMethod: 'ZAINCASH' })

    expect(res.status).toBe(404)

    await prisma.shop.delete({ where: { id: otherShop.id } })
  })

  it('returns 403 when customer has low reliability score', async () => {
    await prisma.reliabilityRecord.create({ data: { userId: customerId, score: 40, noShowCount: 3 } })

    const res = await request(app)
      .post('/api/v1/bookings')
      .set('Authorization', `Bearer ${customerToken}`)
      .send({ shopId, barberId, serviceIds: [serviceId], slot: SLOT, paymentMethod: 'ZAINCASH' })

    expect(res.status).toBe(403)
  })

  it('returns 400 when slot is missing', async () => {
    const res = await request(app)
      .post('/api/v1/bookings')
      .set('Authorization', `Bearer ${customerToken}`)
      .send({ shopId, barberId, serviceIds: [serviceId], paymentMethod: 'ZAINCASH' })

    expect(res.status).toBe(400)
  })
})
