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
  uploadToS3: vi.fn().mockResolvedValue('https://fake-s3.local/shops/test/cover'),
}))

const app = createApp({ NODE_ENV: 'test', CORS_ORIGIN: 'http://localhost:3000' })

const E164_OWNER = '+9647900000095'
const E164_OTHER = '+9647900000096'

const BASE_SHOP = {
  nameEn: 'Upload Test Shop', nameAr: 'محل اختبار الرفع',
  address: 'Test St', city: 'Baghdad',
  neighborhood: 'Karrada', neighborhoodAr: 'الكرادة',
  phone: '+9640000000095', lat: 33.34, lng: 44.40,
  status: 'APPROVED' as const, isActive: true,
}

const FAKE_IMAGE = Buffer.from('fake-jpeg-data')

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

describe('POST /api/v1/shops/:id/cover', () => {
  it('uploads cover and returns url', async () => {
    const res = await request(app)
      .post(`/api/v1/shops/${shopId}/cover`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .attach('file', FAKE_IMAGE, { filename: 'cover.jpg', contentType: 'image/jpeg' })

    expect(res.status).toBe(200)
    expect(res.body.data.url).toBe('https://fake-s3.local/shops/test/cover')
  })

  it('returns 400 for unsupported MIME type', async () => {
    const res = await request(app)
      .post(`/api/v1/shops/${shopId}/cover`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .attach('file', FAKE_IMAGE, { filename: 'cover.gif', contentType: 'image/gif' })

    expect(res.status).toBe(400)
  })

  it('returns 400 when no file is sent', async () => {
    const res = await request(app)
      .post(`/api/v1/shops/${shopId}/cover`)
      .set('Authorization', `Bearer ${ownerToken}`)

    expect(res.status).toBe(400)
  })

  it('returns 403 when a different owner tries to upload', async () => {
    const res = await request(app)
      .post(`/api/v1/shops/${shopId}/cover`)
      .set('Authorization', `Bearer ${otherToken}`)
      .attach('file', FAKE_IMAGE, { filename: 'cover.jpg', contentType: 'image/jpeg' })

    expect(res.status).toBe(403)
  })

  it('returns 401 without a token', async () => {
    const res = await request(app)
      .post(`/api/v1/shops/${shopId}/cover`)
      .attach('file', FAKE_IMAGE, { filename: 'cover.jpg', contentType: 'image/jpeg' })

    expect(res.status).toBe(401)
  })
})

describe('POST /api/v1/shops/:id/logo', () => {
  it('uploads logo and returns url', async () => {
    const res = await request(app)
      .post(`/api/v1/shops/${shopId}/logo`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .attach('file', FAKE_IMAGE, { filename: 'logo.png', contentType: 'image/png' })

    expect(res.status).toBe(200)
    expect(res.body.data.url).toBeDefined()
  })
})
