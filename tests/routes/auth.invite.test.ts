import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import request from 'supertest'
import { createApp } from '@/app'
import { prisma } from '@/config/prisma'
import { signAccess } from '@/lib/jwt'
import { seedOtp, cleanupPhone } from '../helpers/auth'

vi.mock('@/lib/sms', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/sms')>()
  return { ...actual, sendSms: vi.fn().mockResolvedValue(undefined) }
})

const app = createApp({ NODE_ENV: 'test', CORS_ORIGIN: 'http://localhost:3000' })

const E164_BARBER = '+9647900000086'
const E164_OWNER = '+9647900000087'
const BARBER_PHONE = '07900000086'

let shopId: string
let ownerToken: string

beforeEach(async () => {
  const owner = await prisma.user.create({
    data: { phone: E164_OWNER, name: 'Owner', role: 'SHOP_OWNER' },
  })
  const shop = await prisma.shop.create({
    data: {
      ownerId: owner.id,
      nameEn: 'Test Shop',
      nameAr: 'محل تجريبي',
      address: 'Baghdad',
      city: 'Baghdad',
      neighborhood: 'Karrada',
      neighborhoodAr: 'الكرادة',
      phone: '+9640000000001',
      lat: 33.3,
      lng: 44.4,
    },
  })
  shopId = shop.id
  ownerToken = signAccess({ id: owner.id, role: owner.role })
})

afterEach(async () => {
  await prisma.inviteCode.deleteMany({ where: { shopId } })
  await prisma.shop.deleteMany({ where: { id: shopId } })
  await cleanupPhone(E164_OWNER)
  await cleanupPhone(E164_BARBER)
})

describe('POST /api/v1/auth/invite/generate', () => {
  it('returns 200 with a code when called by a shop owner', async () => {
    const res = await request(app)
      .post('/api/v1/auth/invite/generate')
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({ nameEn: 'Ahmed', nameAr: 'أحمد' })

    expect(res.status).toBe(200)
    expect(typeof res.body.data.code).toBe('string')
    expect(res.body.data.expiresAt).toBeTruthy()
  })

  it('returns 403 when called by a non-owner', async () => {
    const customer = await prisma.user.create({
      data: { phone: '+9647800000099', name: 'Cust', role: 'CUSTOMER' },
    })
    const token = signAccess({ id: customer.id, role: customer.role })

    const res = await request(app)
      .post('/api/v1/auth/invite/generate')
      .set('Authorization', `Bearer ${token}`)
      .send({ nameEn: 'Ahmed', nameAr: 'أحمد' })

    expect(res.status).toBe(403)
    await prisma.user.delete({ where: { id: customer.id } })
  })
})

describe('GET /api/v1/auth/invite', () => {
  it('returns shop and barber names for a valid code', async () => {
    const genRes = await request(app)
      .post('/api/v1/auth/invite/generate')
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({ nameEn: 'Ahmed', nameAr: 'أحمد' })
    const { code } = genRes.body.data

    const res = await request(app).get(`/api/v1/auth/invite?code=${code}`)

    expect(res.status).toBe(200)
    expect(res.body.data.shopNameEn).toBe('Test Shop')
    expect(res.body.data.barberNameEn).toBe('Ahmed')
  })

  it('returns 404 for an unknown code', async () => {
    const res = await request(app).get('/api/v1/auth/invite?code=doesnotexist')
    expect(res.status).toBe(404)
  })

  it('returns 410 for an expired code', async () => {
    const barber = await prisma.barber.create({
      data: { shopId, nameEn: 'Test', nameAr: 'تجريبي' },
    })
    await prisma.inviteCode.create({
      data: { shopId, staffId: barber.id, code: 'expiredcode123', expiresAt: new Date(Date.now() - 1000) },
    })

    const res = await request(app).get('/api/v1/auth/invite?code=expiredcode123')
    expect(res.status).toBe(410)
  })
})

describe('POST /api/v1/auth/invite/accept', () => {
  it('creates a new barber user and links them to the barber record', async () => {
    const genRes = await request(app)
      .post('/api/v1/auth/invite/generate')
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({ nameEn: 'Ahmed', nameAr: 'أحمد' })
    const { code } = genRes.body.data

    const otp = await seedOtp(E164_BARBER)

    const res = await request(app)
      .post('/api/v1/auth/invite/accept')
      .send({ code, phone: BARBER_PHONE, otp })

    expect(res.status).toBe(200)
    expect(res.body.data.accessToken).toBeTruthy()
    expect(res.headers['set-cookie']).toBeDefined()

    const user = await prisma.user.findUnique({ where: { phone: E164_BARBER } })
    expect(user?.role).toBe('BARBER')
    expect(user?.shopId).toBe(shopId)

    const barber = await prisma.barber.findFirst({ where: { shopId, userId: user?.id } })
    expect(barber).not.toBeNull()
  })

  it('returns 409 when the code has already been used', async () => {
    const barber = await prisma.barber.create({
      data: { shopId, nameEn: 'Test', nameAr: 'تجريبي' },
    })
    await prisma.inviteCode.create({
      data: {
        shopId,
        staffId: barber.id,
        code: 'usedcode456',
        expiresAt: new Date(Date.now() + 48 * 60 * 60 * 1000),
        usedAt: new Date(),
      },
    })

    const otp = await seedOtp(E164_BARBER)
    const res = await request(app)
      .post('/api/v1/auth/invite/accept')
      .send({ code: 'usedcode456', phone: BARBER_PHONE, otp })

    expect(res.status).toBe(409)
  })
})
