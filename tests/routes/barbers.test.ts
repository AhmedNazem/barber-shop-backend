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

const E164_OWNER = '+9647900000102'
const E164_OTHER = '+9647900000103'

const BASE_SHOP = {
  nameEn: 'Barber Shop', nameAr: 'محل',
  address: 'St', city: 'Baghdad',
  neighborhood: 'K', neighborhoodAr: 'ك',
  phone: '+9640000000102', lat: 33.34, lng: 44.40,
  status: 'APPROVED' as const, isActive: true,
}

const BARBER_BODY = { nameEn: 'Ahmed', nameAr: 'أحمد', experienceYears: 5, specialties: ['fade', 'beard'] }

let ownerId: string
let ownerToken: string
let otherToken: string
let shopId: string

beforeEach(async () => {
  const owner = await prisma.user.create({ data: { phone: E164_OWNER, name: 'Owner', role: 'SHOP_OWNER' } })
  ownerId = owner.id

  const other = await prisma.user.create({ data: { phone: E164_OTHER, name: 'Other', role: 'SHOP_OWNER' } })
  otherToken = signAccess({ id: other.id, role: other.role, shopId: undefined })

  const shop = await prisma.shop.create({ data: { ...BASE_SHOP, ownerId } })
  shopId = shop.id

  // Token must include shopId so requireOwnership passes
  ownerToken = signAccess({ id: owner.id, role: owner.role, shopId })
})

afterEach(async () => {
  await prisma.shop.deleteMany({ where: { ownerId } })
  await cleanupPhone(E164_OWNER)
  await cleanupPhone(E164_OTHER)
})

describe('GET /api/v1/shops/:shopId/barbers', () => {
  it('returns active barbers only (public)', async () => {
    await prisma.barber.create({ data: { shopId, nameEn: 'Active', nameAr: 'نشط' } })
    await prisma.barber.create({ data: { shopId, nameEn: 'Inactive', nameAr: 'غير نشط', isActive: false } })

    const res = await request(app).get(`/api/v1/shops/${shopId}/barbers`)

    expect(res.status).toBe(200)
    expect(res.body.data.length).toBe(1)
    expect(res.body.data[0].nameEn).toBe('Active')
  })
})

describe('POST /api/v1/shops/:shopId/barbers', () => {
  it('creates a barber and returns 201', async () => {
    const res = await request(app)
      .post(`/api/v1/shops/${shopId}/barbers`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .send(BARBER_BODY)

    expect(res.status).toBe(201)
    expect(res.body.data.nameEn).toBe('Ahmed')
    expect(res.body.data.specialties).toEqual(['fade', 'beard'])
  })

  it('returns 403 for a different owner', async () => {
    const res = await request(app)
      .post(`/api/v1/shops/${shopId}/barbers`)
      .set('Authorization', `Bearer ${otherToken}`)
      .send(BARBER_BODY)

    expect(res.status).toBe(403)
  })

  it('returns 400 for missing required fields', async () => {
    const res = await request(app)
      .post(`/api/v1/shops/${shopId}/barbers`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({ nameEn: 'Ahmed' })

    expect(res.status).toBe(400)
  })
})

describe('PATCH /api/v1/shops/:shopId/barbers/:barberId', () => {
  it('updates barber fields', async () => {
    const barber = await prisma.barber.create({ data: { shopId, ...BARBER_BODY } })

    const res = await request(app)
      .patch(`/api/v1/shops/${shopId}/barbers/${barber.id}`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({ experienceYears: 10 })

    expect(res.status).toBe(200)
    expect(res.body.data.experienceYears).toBe(10)
  })
})

describe('DELETE /api/v1/shops/:shopId/barbers/:barberId', () => {
  it('soft-deactivates barber (isActive = false)', async () => {
    const barber = await prisma.barber.create({ data: { shopId, ...BARBER_BODY } })

    const res = await request(app)
      .delete(`/api/v1/shops/${shopId}/barbers/${barber.id}`)
      .set('Authorization', `Bearer ${ownerToken}`)

    expect(res.status).toBe(200)
    const updated = await prisma.barber.findUnique({ where: { id: barber.id } })
    expect(updated!.isActive).toBe(false)
  })

  it('returns 403 for a different owner', async () => {
    const barber = await prisma.barber.create({ data: { shopId, ...BARBER_BODY } })

    const res = await request(app)
      .delete(`/api/v1/shops/${shopId}/barbers/${barber.id}`)
      .set('Authorization', `Bearer ${otherToken}`)

    expect(res.status).toBe(403)
  })
})
