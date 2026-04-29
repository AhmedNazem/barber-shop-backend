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

const E164_OWNER = '+9647900000090'

const BASE_SHOP = {
  nameEn: 'Detail Shop', nameAr: 'محل التفاصيل',
  address: 'Test St', city: 'Baghdad',
  neighborhood: 'Karrada', neighborhoodAr: 'الكرادة',
  phone: '+9640000000020', lat: 33.34, lng: 44.40,
  status: 'APPROVED' as const, isActive: true,
}

let ownerId: string
let shopId: string

beforeEach(async () => {
  const owner = await prisma.user.create({
    data: { phone: E164_OWNER, name: 'Owner', role: 'SHOP_OWNER' },
  })
  ownerId = owner.id
  const shop = await prisma.shop.create({ data: { ...BASE_SHOP, ownerId } })
  shopId = shop.id
})

afterEach(async () => {
  await prisma.shop.deleteMany({ where: { ownerId } })
  await cleanupPhone(E164_OWNER)
})

describe('GET /api/v1/shops/:id', () => {
  it('returns full shop detail with correct shape', async () => {
    const res = await request(app).get(`/api/v1/shops/${shopId}`)

    expect(res.status).toBe(200)
    expect(res.body.data.id).toBe(shopId)
    expect(res.body.data.nameEn).toBe('Detail Shop')
    expect(res.body.data.neighborhood).toBe('Karrada')
    expect(Array.isArray(res.body.data.services)).toBe(true)
    expect(Array.isArray(res.body.data.barbers)).toBe(true)
    expect(typeof res.body.data.isOpen).toBe('boolean')
    expect(['low', 'medium', 'high']).toContain(res.body.data.load)
    expect(res.body.data.avgRating).toBeNull()
    expect(res.body.data.reviewCount).toBe(0)
    expect(res.body.data.discount).toBeNull()
  })

  it('returns 404 for a non-existent shop id', async () => {
    const res = await request(app).get('/api/v1/shops/nonexistentid123')
    expect(res.status).toBe(404)
  })

  it('returns 404 for a PENDING shop', async () => {
    const pending = await prisma.shop.create({
      data: { ...BASE_SHOP, ownerId, nameEn: 'Pending', phone: '+9640000000021', status: 'PENDING' },
    })

    const res = await request(app).get(`/api/v1/shops/${pending.id}`)
    expect(res.status).toBe(404)

    await prisma.shop.delete({ where: { id: pending.id } })
  })

  it('includes active services in the response', async () => {
    await prisma.service.create({
      data: { shopId, nameEn: 'Haircut', nameAr: 'قص شعر', price: 5000, durationMin: 30, category: 'cut' },
    })

    const res = await request(app).get(`/api/v1/shops/${shopId}`)

    expect(res.status).toBe(200)
    expect(res.body.data.services.length).toBe(1)
    expect(res.body.data.services[0].nameEn).toBe('Haircut')
  })

  it('includes active barbers in the response', async () => {
    await prisma.barber.create({
      data: { shopId, nameEn: 'Ahmed', nameAr: 'أحمد' },
    })

    const res = await request(app).get(`/api/v1/shops/${shopId}`)

    expect(res.status).toBe(200)
    expect(res.body.data.barbers.length).toBe(1)
    expect(res.body.data.barbers[0].nameEn).toBe('Ahmed')
  })
})
