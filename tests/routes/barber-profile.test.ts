import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import request from 'supertest'
import { createApp } from '@/app'
import { prisma } from '@/config/prisma'
import { cleanupPhone } from '../helpers/auth'

vi.mock('@/lib/sms', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/sms')>()
  return { ...actual, sendSms: vi.fn().mockResolvedValue(undefined) }
})

const app = createApp({ NODE_ENV: 'test', CORS_ORIGIN: 'http://localhost:3000' })

const E164_OWNER = '+9647900000108'

const BASE_SHOP = {
  nameEn: 'Profile Shop', nameAr: 'محل',
  address: 'St', city: 'Baghdad',
  neighborhood: 'K', neighborhoodAr: 'ك',
  phone: '+9640000000108', lat: 33.34, lng: 44.40,
  status: 'APPROVED' as const, isActive: true,
}

let ownerId: string
let shopId: string
let barberId: string

beforeEach(async () => {
  const owner = await prisma.user.create({ data: { phone: E164_OWNER, name: 'Owner', role: 'SHOP_OWNER' } })
  ownerId = owner.id

  const shop = await prisma.shop.create({ data: { ...BASE_SHOP, ownerId } })
  shopId = shop.id

  const barber = await prisma.barber.create({
    data: { shopId, nameEn: 'Ahmed', nameAr: 'أحمد', experienceYears: 5, specialties: ['fade', 'beard'] },
  })
  barberId = barber.id

  await prisma.barberSchedule.createMany({
    data: [
      { barberId, dayOfWeek: 1, startTime: '09:00', endTime: '17:00', isAvailable: true },
      { barberId, dayOfWeek: 6, startTime: '00:00', endTime: '00:00', isAvailable: false },
    ],
  })

  await prisma.barberPortfolio.create({ data: { barberId, photoUrl: 'https://fake.local/p1.jpg', order: 0 } })
})

afterEach(async () => {
  await prisma.shop.deleteMany({ where: { ownerId } })
  await cleanupPhone(E164_OWNER)
})

describe('GET /api/v1/barbers/:barberId', () => {
  it('returns full barber profile', async () => {
    const res = await request(app).get(`/api/v1/barbers/${barberId}`)

    expect(res.status).toBe(200)
    expect(res.body.data.nameEn).toBe('Ahmed')
    expect(res.body.data.yearsExp).toBe(5)
    expect(res.body.data.shopId).toBe(shopId)
    expect(res.body.data.serviceKeys).toEqual(['fade', 'beard'])
    expect(res.body.data.avgRating).toBe(0)
    expect(res.body.data.portfolio).toHaveLength(1)
    expect(res.body.data.availability.mon).toEqual({ from: '09:00', to: '17:00' })
    expect(res.body.data.availability.sat).toBeNull()
  })

  it('returns 404 for unknown barber', async () => {
    const res = await request(app).get('/api/v1/barbers/nonexistent-id')
    expect(res.status).toBe(404)
  })
})

describe('GET /api/v1/barbers/:barberId/availability', () => {
  it('returns week availability map', async () => {
    const res = await request(app).get(`/api/v1/barbers/${barberId}/availability`)

    expect(res.status).toBe(200)
    expect(res.body.data.mon).toEqual({ from: '09:00', to: '17:00' })
    expect(res.body.data.sat).toBeNull()
    expect(res.body.data.tue).toBeNull()
  })
})

describe('GET /api/v1/barbers/:barberId/portfolio', () => {
  it('returns array of photo URLs', async () => {
    const res = await request(app).get(`/api/v1/barbers/${barberId}/portfolio`)

    expect(res.status).toBe(200)
    expect(res.body.data).toHaveLength(1)
    expect(res.body.data[0]).toBe('https://fake.local/p1.jpg')
  })
})

describe('GET /api/v1/barbers/:barberId/reviews', () => {
  it('returns empty list when no reviews', async () => {
    const res = await request(app).get(`/api/v1/barbers/${barberId}/reviews`)

    expect(res.status).toBe(200)
    expect(res.body.data.reviews).toHaveLength(0)
    expect(res.body.data.total).toBe(0)
  })
})
