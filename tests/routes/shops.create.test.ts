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

const E164_OWNER    = '+9647900000091'
const E164_CUSTOMER = '+9647900000092'

const SHOP_BODY = {
  nameEn: 'Create Test Shop', nameAr: 'محل اختبار',
  address: 'Test St', city: 'Baghdad',
  neighborhood: 'Karrada', neighborhoodAr: 'الكرادة',
  phone: '+9647000000091', lat: 33.34, lng: 44.40,
}

let ownerId: string
let ownerToken: string
let customerToken: string

beforeEach(async () => {
  const owner = await prisma.user.create({
    data: { phone: E164_OWNER, name: 'Owner', role: 'SHOP_OWNER' },
  })
  ownerId = owner.id
  ownerToken = signAccess({ id: owner.id, role: owner.role })

  const customer = await prisma.user.create({
    data: { phone: E164_CUSTOMER, name: 'Customer', role: 'CUSTOMER' },
  })
  customerToken = signAccess({ id: customer.id, role: customer.role })
})

afterEach(async () => {
  await prisma.shop.deleteMany({ where: { ownerId } })
  await cleanupPhone(E164_OWNER)
  await cleanupPhone(E164_CUSTOMER)
})

describe('POST /api/v1/shops', () => {
  it('creates shop with PENDING status and returns 201', async () => {
    const res = await request(app)
      .post('/api/v1/shops')
      .set('Authorization', `Bearer ${ownerToken}`)
      .send(SHOP_BODY)

    expect(res.status).toBe(201)
    expect(res.body.data.nameEn).toBe('Create Test Shop')
    expect(res.body.data.status).toBe('PENDING')
    expect(res.body.data.ownerId).toBe(ownerId)
  })

  it('returns 401 without a token', async () => {
    const res = await request(app).post('/api/v1/shops').send(SHOP_BODY)
    expect(res.status).toBe(401)
  })

  it('returns 403 for CUSTOMER role', async () => {
    const res = await request(app)
      .post('/api/v1/shops')
      .set('Authorization', `Bearer ${customerToken}`)
      .send(SHOP_BODY)

    expect(res.status).toBe(403)
  })

  it('returns 409 if owner already has a shop', async () => {
    await prisma.shop.create({ data: { ...SHOP_BODY, ownerId, status: 'PENDING' } })

    const res = await request(app)
      .post('/api/v1/shops')
      .set('Authorization', `Bearer ${ownerToken}`)
      .send(SHOP_BODY)

    expect(res.status).toBe(409)
  })

  it('returns 400 for missing required fields', async () => {
    const res = await request(app)
      .post('/api/v1/shops')
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({ nameEn: 'Only Name' })

    expect(res.status).toBe(400)
  })
})
