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

const E164_OWNER = '+9647900000098'
const E164_OTHER = '+9647900000099'

const BASE_SHOP = {
  nameEn: 'Service Shop', nameAr: 'محل خدمات',
  address: 'St', city: 'Baghdad',
  neighborhood: 'K', neighborhoodAr: 'ك',
  phone: '+9640000000098', lat: 33.34, lng: 44.40,
  status: 'APPROVED' as const, isActive: true,
}

const SERVICE_BODY = { nameEn: 'Haircut', nameAr: 'قص شعر', price: 5000, durationMin: 30, category: 'cut' }

let ownerId: string
let ownerToken: string
let otherToken: string
let shopId: string

beforeEach(async () => {
  const owner = await prisma.user.create({ data: { phone: E164_OWNER, name: 'Owner', role: 'SHOP_OWNER' } })
  ownerId = owner.id
  ownerToken = signAccess({ id: owner.id, role: owner.role })

  const other = await prisma.user.create({ data: { phone: E164_OTHER, name: 'Other', role: 'SHOP_OWNER' } })
  otherToken = signAccess({ id: other.id, role: other.role })

  const shop = await prisma.shop.create({ data: { ...BASE_SHOP, ownerId } })
  shopId = shop.id
})

afterEach(async () => {
  await prisma.shop.deleteMany({ where: { ownerId } })
  await cleanupPhone(E164_OWNER)
  await cleanupPhone(E164_OTHER)
})

describe('GET /api/v1/shops/:shopId/services', () => {
  it('returns active services only (public)', async () => {
    await prisma.service.create({ data: { shopId, ...SERVICE_BODY } })
    await prisma.service.create({ data: { shopId, ...SERVICE_BODY, nameEn: 'Inactive', nameAr: 'غير نشط', isActive: false } })

    const res = await request(app).get(`/api/v1/shops/${shopId}/services`)

    expect(res.status).toBe(200)
    expect(res.body.data.length).toBe(1)
    expect(res.body.data[0].nameEn).toBe('Haircut')
  })
})

describe('POST /api/v1/shops/:shopId/services', () => {
  it('creates a service and returns 201', async () => {
    const res = await request(app)
      .post(`/api/v1/shops/${shopId}/services`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .send(SERVICE_BODY)

    expect(res.status).toBe(201)
    expect(res.body.data.nameEn).toBe('Haircut')
    expect(res.body.data.shopId).toBe(shopId)
  })

  it('returns 403 for a different owner', async () => {
    const res = await request(app)
      .post(`/api/v1/shops/${shopId}/services`)
      .set('Authorization', `Bearer ${otherToken}`)
      .send(SERVICE_BODY)

    expect(res.status).toBe(403)
  })

  it('returns 400 for missing fields', async () => {
    const res = await request(app)
      .post(`/api/v1/shops/${shopId}/services`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({ nameEn: 'Haircut' })

    expect(res.status).toBe(400)
  })
})

describe('PATCH /api/v1/shops/:shopId/services/:serviceId', () => {
  it('updates service fields', async () => {
    const svc = await prisma.service.create({ data: { shopId, ...SERVICE_BODY } })

    const res = await request(app)
      .patch(`/api/v1/shops/${shopId}/services/${svc.id}`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({ price: 7500, isActive: false })

    expect(res.status).toBe(200)
    expect(res.body.data.price).toBe(7500)
    expect(res.body.data.isActive).toBe(false)
  })

  it('returns 404 for a service not belonging to the shop', async () => {
    const res = await request(app)
      .patch(`/api/v1/shops/${shopId}/services/nonexistent`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({ price: 1000 })

    expect(res.status).toBe(404)
  })
})

describe('DELETE /api/v1/shops/:shopId/services/:serviceId', () => {
  it('deletes a service with no upcoming bookings', async () => {
    const svc = await prisma.service.create({ data: { shopId, ...SERVICE_BODY } })

    const res = await request(app)
      .delete(`/api/v1/shops/${shopId}/services/${svc.id}`)
      .set('Authorization', `Bearer ${ownerToken}`)

    expect(res.status).toBe(200)
    const gone = await prisma.service.findUnique({ where: { id: svc.id } })
    expect(gone).toBeNull()
  })

  it('returns 403 for a different owner', async () => {
    const svc = await prisma.service.create({ data: { shopId, ...SERVICE_BODY } })

    const res = await request(app)
      .delete(`/api/v1/shops/${shopId}/services/${svc.id}`)
      .set('Authorization', `Bearer ${otherToken}`)

    expect(res.status).toBe(403)
  })
})
