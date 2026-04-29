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

const E164_OWNER = '+9647900000093'
const E164_OTHER = '+9647900000094'

const BASE_SHOP = {
  nameEn: 'Update Test Shop', nameAr: 'محل اختبار التعديل',
  address: 'Test St', city: 'Baghdad',
  neighborhood: 'Karrada', neighborhoodAr: 'الكرادة',
  phone: '+9640000000093', lat: 33.34, lng: 44.40,
  status: 'APPROVED' as const, isActive: true,
}

let ownerId: string
let ownerToken: string
let otherToken: string
let shopId: string

beforeEach(async () => {
  const owner = await prisma.user.create({
    data: { phone: E164_OWNER, name: 'Owner', role: 'SHOP_OWNER' },
  })
  ownerId = owner.id
  ownerToken = signAccess({ id: owner.id, role: owner.role })

  const other = await prisma.user.create({
    data: { phone: E164_OTHER, name: 'Other', role: 'SHOP_OWNER' },
  })
  otherToken = signAccess({ id: other.id, role: other.role })

  const shop = await prisma.shop.create({ data: { ...BASE_SHOP, ownerId } })
  shopId = shop.id
})

afterEach(async () => {
  await prisma.shop.deleteMany({ where: { ownerId } })
  await cleanupPhone(E164_OWNER)
  await cleanupPhone(E164_OTHER)
})

describe('PATCH /api/v1/shops/:id', () => {
  it('updates allowed fields and returns the shop', async () => {
    const res = await request(app)
      .patch(`/api/v1/shops/${shopId}`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({ nameEn: 'Renamed Shop', city: 'Basra' })

    expect(res.status).toBe(200)
    expect(res.body.data.nameEn).toBe('Renamed Shop')
    expect(res.body.data.city).toBe('Basra')
    expect(res.body.data.nameAr).toBe('محل اختبار التعديل')
  })

  it('returns 401 without a token', async () => {
    const res = await request(app).patch(`/api/v1/shops/${shopId}`).send({ nameEn: 'X' })
    expect(res.status).toBe(401)
  })

  it('returns 404 for a non-existent shop', async () => {
    const res = await request(app)
      .patch('/api/v1/shops/nonexistentid')
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({ city: 'Basra' })

    expect(res.status).toBe(404)
  })

  it('returns 403 when a different owner tries to update', async () => {
    const res = await request(app)
      .patch(`/api/v1/shops/${shopId}`)
      .set('Authorization', `Bearer ${otherToken}`)
      .send({ nameEn: 'Hijacked' })

    expect(res.status).toBe(403)
  })

  it('accepts a partial body with a single field', async () => {
    const res = await request(app)
      .patch(`/api/v1/shops/${shopId}`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({ lat: 34.00 })

    expect(res.status).toBe(200)
    expect(res.body.data.lat).toBe(34.00)
  })
})
