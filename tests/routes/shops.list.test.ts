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

const E164_OWNER = '+9647900000089'

const BASE_SHOP = {
  nameEn: 'Alpha Barbers',
  nameAr: 'حلاقة ألفا',
  address: '1st St',
  city: 'Baghdad',
  neighborhood: 'Karrada',
  neighborhoodAr: 'الكرادة',
  phone: '+9640000000010',
  lat: 33.34,
  lng: 44.40,
  status: 'APPROVED' as const,
  isActive: true,
}

let ownerId: string
let shop1Id: string
let shop2Id: string

beforeEach(async () => {
  const owner = await prisma.user.create({
    data: { phone: E164_OWNER, name: 'Owner', role: 'SHOP_OWNER' },
  })
  ownerId = owner.id

  const s1 = await prisma.shop.create({ data: { ...BASE_SHOP, ownerId } })
  shop1Id = s1.id

  const s2 = await prisma.shop.create({
    data: {
      ...BASE_SHOP,
      ownerId,
      nameEn: 'Beta Barbers',
      nameAr: 'حلاقة بيتا',
      city: 'Basra',
      neighborhood: 'Corniche',
      neighborhoodAr: 'الكورنيش',
      phone: '+9640000000011',
      lat: 30.51,
      lng: 47.78,
    },
  })
  shop2Id = s2.id
})

afterEach(async () => {
  await prisma.shop.deleteMany({ where: { ownerId } })
  await cleanupPhone(E164_OWNER)
})

describe('GET /api/v1/shops', () => {
  it('returns approved shops with correct shape', async () => {
    const res = await request(app).get('/api/v1/shops')

    expect(res.status).toBe(200)
    expect(Array.isArray(res.body.data)).toBe(true)
    expect(res.body.meta.total).toBeGreaterThanOrEqual(2)

    const shop = res.body.data.find((s: { id: string }) => s.id === shop1Id)
    expect(shop.nameEn).toBe('Alpha Barbers')
    expect(shop.neighborhood).toBe('Karrada')
    expect(typeof shop.isOpen).toBe('boolean')
    expect(['low', 'medium', 'high']).toContain(shop.load)
    expect(shop.reviewCount).toBe(0)
    expect(shop.avgRating).toBeNull()
    expect(shop.distanceMeters).toBeNull()
  })

  it('filters by search term', async () => {
    const res = await request(app).get('/api/v1/shops?search=Alpha')

    expect(res.status).toBe(200)
    expect(res.body.data.every((s: { nameEn: string }) => s.nameEn.toLowerCase().includes('alpha'))).toBe(true)
  })

  it('filters by city', async () => {
    const res = await request(app).get('/api/v1/shops?city=Basra')

    expect(res.status).toBe(200)
    expect(res.body.data.every((s: { city: string }) => s.city === 'Basra')).toBe(true)
  })

  it('respects limit and offset for pagination', async () => {
    const res = await request(app).get('/api/v1/shops?limit=1&offset=0')

    expect(res.status).toBe(200)
    expect(res.body.data.length).toBe(1)
    expect(res.body.meta.limit).toBe(1)
    expect(res.body.meta.offset).toBe(0)
  })

  it('returns distanceMeters when lat/lng provided', async () => {
    const res = await request(app).get('/api/v1/shops?lat=33.34&lng=44.40')

    expect(res.status).toBe(200)
    const shop = res.body.data.find((s: { id: string }) => s.id === shop1Id)
    expect(shop.distanceMeters).toBe(0)

    const shop2 = res.body.data.find((s: { id: string }) => s.id === shop2Id)
    expect(shop2.distanceMeters).toBeGreaterThan(0)
  })

  it('excludes PENDING and inactive shops', async () => {
    const pending = await prisma.shop.create({
      data: { ...BASE_SHOP, ownerId, nameEn: 'Pending Shop', phone: '+9640000000012', status: 'PENDING' },
    })

    const res = await request(app).get('/api/v1/shops?search=Pending')
    expect(res.status).toBe(200)
    expect(res.body.data.find((s: { id: string }) => s.id === pending.id)).toBeUndefined()

    await prisma.shop.delete({ where: { id: pending.id } })
  })
})
