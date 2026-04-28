import { describe, it, expect, afterEach, vi } from 'vitest'
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

const E164 = '+9647900000088'

afterEach(async () => {
  const user = await prisma.user.findUnique({ where: { phone: E164 } })
  if (user) await prisma.shop.deleteMany({ where: { ownerId: user.id } })
  await cleanupPhone(E164)
})

async function seedOwnerWithShop(status = 'PENDING', rejectionReason?: string) {
  const owner = await prisma.user.create({
    data: { phone: E164, name: 'Owner', role: 'SHOP_OWNER' },
  })
  await prisma.shop.create({
    data: {
      ownerId: owner.id,
      nameEn: 'Test Shop',
      nameAr: 'محل تجريبي',
      address: 'Baghdad',
      city: 'Baghdad',
      phone: '+9640000000002',
      lat: 33.3,
      lng: 44.4,
      status: status as never,
      ...(rejectionReason && { rejectionReason }),
    },
  })
  return signAccess({ id: owner.id, role: owner.role })
}

describe('GET /api/v1/shop/status', () => {
  it('returns status for a pending shop', async () => {
    const token = await seedOwnerWithShop('PENDING')

    const res = await request(app)
      .get('/api/v1/shop/status')
      .set('Authorization', `Bearer ${token}`)

    expect(res.status).toBe(200)
    expect(res.body.data.status).toBe('PENDING')
    expect(res.body.data.rejectionReason).toBeUndefined()
  })

  it('returns status and rejectionReason for a rejected shop', async () => {
    const token = await seedOwnerWithShop('REJECTED', 'Incomplete documents')

    const res = await request(app)
      .get('/api/v1/shop/status')
      .set('Authorization', `Bearer ${token}`)

    expect(res.status).toBe(200)
    expect(res.body.data.status).toBe('REJECTED')
    expect(res.body.data.rejectionReason).toBe('Incomplete documents')
  })

  it('returns 401 without a token', async () => {
    const res = await request(app).get('/api/v1/shop/status')
    expect(res.status).toBe(401)
  })

  it('returns 403 for a non-owner role', async () => {
    const customer = await prisma.user.create({
      data: { phone: E164, name: 'Cust', role: 'CUSTOMER' },
    })
    const token = signAccess({ id: customer.id, role: customer.role })

    const res = await request(app)
      .get('/api/v1/shop/status')
      .set('Authorization', `Bearer ${token}`)

    expect(res.status).toBe(403)
  })

  it('returns 404 when the owner has no shop yet', async () => {
    const owner = await prisma.user.create({
      data: { phone: E164, name: 'Owner', role: 'SHOP_OWNER' },
    })
    const token = signAccess({ id: owner.id, role: owner.role })

    const res = await request(app)
      .get('/api/v1/shop/status')
      .set('Authorization', `Bearer ${token}`)

    expect(res.status).toBe(404)
  })
})
