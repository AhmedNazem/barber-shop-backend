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

vi.mock('@/lib/s3', () => ({
  uploadToS3: vi.fn().mockResolvedValue('https://fake-s3.local/photo'),
}))

const app = createApp({ NODE_ENV: 'test', CORS_ORIGIN: 'http://localhost:3000' })

const E164_OWNER = '+9647900000100'
const E164_OTHER = '+9647900000101'
const FAKE_IMAGE = Buffer.from('fake-png-data')

const BASE_SHOP = {
  nameEn: 'Photo Shop', nameAr: 'محل',
  address: 'St', city: 'Baghdad',
  neighborhood: 'K', neighborhoodAr: 'ك',
  phone: '+9640000000100', lat: 33.34, lng: 44.40,
  status: 'APPROVED' as const, isActive: true,
}

let ownerId: string
let ownerToken: string
let otherToken: string
let shopId: string
let serviceId: string

beforeEach(async () => {
  const owner = await prisma.user.create({ data: { phone: E164_OWNER, name: 'Owner', role: 'SHOP_OWNER' } })
  ownerId = owner.id
  ownerToken = signAccess({ id: owner.id, role: owner.role })

  const other = await prisma.user.create({ data: { phone: E164_OTHER, name: 'Other', role: 'SHOP_OWNER' } })
  otherToken = signAccess({ id: other.id, role: other.role })

  const shop = await prisma.shop.create({ data: { ...BASE_SHOP, ownerId } })
  shopId = shop.id

  const svc = await prisma.service.create({
    data: { shopId, nameEn: 'Haircut', nameAr: 'قص شعر', price: 5000, durationMin: 30, category: 'cut' },
  })
  serviceId = svc.id
})

afterEach(async () => {
  await prisma.shop.deleteMany({ where: { ownerId } })
  await cleanupPhone(E164_OWNER)
  await cleanupPhone(E164_OTHER)
})

describe('POST /api/v1/shops/:shopId/services/:serviceId/photos', () => {
  it('uploads photo and returns 201 with url', async () => {
    const res = await request(app)
      .post(`/api/v1/shops/${shopId}/services/${serviceId}/photos`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .attach('file', FAKE_IMAGE, { filename: 'photo.png', contentType: 'image/png' })

    expect(res.status).toBe(201)
    expect(res.body.data.url).toBeDefined()
    expect(res.body.data.order).toBe(0)
  })

  it('increments order for each subsequent photo', async () => {
    await request(app)
      .post(`/api/v1/shops/${shopId}/services/${serviceId}/photos`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .attach('file', FAKE_IMAGE, { filename: 'photo.png', contentType: 'image/png' })

    const res = await request(app)
      .post(`/api/v1/shops/${shopId}/services/${serviceId}/photos`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .attach('file', FAKE_IMAGE, { filename: 'photo.png', contentType: 'image/png' })

    expect(res.body.data.order).toBe(1)
  })

  it('returns 403 for a different owner', async () => {
    const res = await request(app)
      .post(`/api/v1/shops/${shopId}/services/${serviceId}/photos`)
      .set('Authorization', `Bearer ${otherToken}`)
      .attach('file', FAKE_IMAGE, { filename: 'photo.png', contentType: 'image/png' })

    expect(res.status).toBe(403)
  })
})

describe('DELETE /api/v1/photos/:photoId', () => {
  it('deletes photo and returns ok', async () => {
    const photo = await prisma.servicePhoto.create({ data: { serviceId, url: 'https://x.com/p.jpg', order: 0 } })

    const res = await request(app)
      .delete(`/api/v1/photos/${photo.id}`)
      .set('Authorization', `Bearer ${ownerToken}`)

    expect(res.status).toBe(200)
    expect(await prisma.servicePhoto.findUnique({ where: { id: photo.id } })).toBeNull()
  })

  it('returns 403 for a different owner', async () => {
    const photo = await prisma.servicePhoto.create({ data: { serviceId, url: 'https://x.com/p.jpg', order: 0 } })

    const res = await request(app)
      .delete(`/api/v1/photos/${photo.id}`)
      .set('Authorization', `Bearer ${otherToken}`)

    expect(res.status).toBe(403)
  })
})

describe('PATCH /api/v1/shops/:shopId/services/:serviceId/photos/reorder', () => {
  it('reorders photos by updating their order field', async () => {
    const p1 = await prisma.servicePhoto.create({ data: { serviceId, url: 'u1', order: 0 } })
    const p2 = await prisma.servicePhoto.create({ data: { serviceId, url: 'u2', order: 1 } })

    const res = await request(app)
      .patch(`/api/v1/shops/${shopId}/services/${serviceId}/photos/reorder`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({ photoIds: [p2.id, p1.id] })

    expect(res.status).toBe(200)
    const updated1 = await prisma.servicePhoto.findUnique({ where: { id: p2.id } })
    const updated2 = await prisma.servicePhoto.findUnique({ where: { id: p1.id } })
    expect(updated1!.order).toBe(0)
    expect(updated2!.order).toBe(1)
  })
})
