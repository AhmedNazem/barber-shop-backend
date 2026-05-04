import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import request from 'supertest'
import { createApp } from '@/app'
import { prisma } from '@/config/prisma'
import { signAccess } from '@/lib/jwt'
import { cleanupPhone } from '../helpers/auth'

vi.mock('@/lib/s3', () => ({
  uploadToS3: vi.fn().mockResolvedValue('https://cdn.example.com/test.jpg'),
}))

const app = createApp({ NODE_ENV: 'test', CORS_ORIGIN: 'http://localhost:3000' })

const E164_OWNER = '+9647900000134'
const E164_ADMIN = '+9647900000135'
const E164_CUST  = '+9647900000136'

let ownerId: string
let adminId: string
let custId:  string
let shopId:  string
let ownerToken: string
let adminToken: string
let custToken:  string

beforeEach(async () => {
  await cleanupPhone(E164_OWNER)
  await cleanupPhone(E164_ADMIN)
  await cleanupPhone(E164_CUST)

  const owner = await prisma.user.create({ data: { phone: E164_OWNER, name: 'Owner', role: 'SHOP_OWNER' } })
  const admin = await prisma.user.create({ data: { phone: E164_ADMIN, name: 'Admin', role: 'ADMIN' } })
  const cust  = await prisma.user.create({ data: { phone: E164_CUST,  name: 'Cust',  role: 'CUSTOMER' } })

  ownerId = owner.id
  adminId = admin.id
  custId  = cust.id

  const shop = await prisma.shop.create({
    data: {
      ownerId, nameEn: 'Plan Test Shop', nameAr: 'محل تجريبي',
      address: 'Test St', city: 'Baghdad', neighborhood: 'A', neighborhoodAr: 'أ',
      phone: '+9641234567891', lat: 33.3, lng: 44.4,
      status: 'APPROVED', isActive: true, plan: 'FREE',
    },
  })
  shopId = shop.id

  ownerToken = signAccess({ id: ownerId, role: 'SHOP_OWNER', shopId })
  adminToken = signAccess({ id: adminId, role: 'ADMIN',      shopId: undefined })
  custToken  = signAccess({ id: custId,  role: 'CUSTOMER',   shopId: undefined })
})

afterEach(async () => {
  await prisma.barber.deleteMany({ where: { shopId } })
  await prisma.service.deleteMany({ where: { shopId } })
  await prisma.shop.deleteMany({ where: { id: shopId } })
  await cleanupPhone(E164_OWNER)
  await cleanupPhone(E164_ADMIN)
  await cleanupPhone(E164_CUST)
})

// ─── Plan endpoints ───────────────────────────────────────────────────────────

describe('GET /shop/:id/plan', () => {
  it('returns plan + features for owner', async () => {
    const res = await request(app)
      .get(`/api/v1/shop/${shopId}/plan`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .expect(200)

    expect(res.body.data.plan).toBe('FREE')
    expect(res.body.data.features.onlineBookings).toBe(false)
    expect(res.body.data.features.maxBarbers).toBe(1)
    expect(res.body.data.features.analytics).toBe(false)
  })
})

describe('PATCH /admin/shops/:id/plan', () => {
  it('admin upgrades shop to STARTER', async () => {
    await request(app)
      .patch(`/api/v1/admin/shops/${shopId}/plan`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ plan: 'STARTER' })
      .expect(200)

    const shop = await prisma.shop.findUnique({ where: { id: shopId } })
    expect(shop?.plan).toBe('STARTER')
  })

  it('blocks non-admin (403)', async () => {
    await request(app)
      .patch(`/api/v1/admin/shops/${shopId}/plan`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({ plan: 'STARTER' })
      .expect(403)
  })
})

// ─── Booking mode ─────────────────────────────────────────────────────────────

describe('PATCH /shop/:id/booking-mode', () => {
  it('owner changes booking mode to BOTH', async () => {
    await request(app)
      .patch(`/api/v1/shop/${shopId}/booking-mode`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({ mode: 'BOTH' })
      .expect(200)

    const shop = await prisma.shop.findUnique({ where: { id: shopId } })
    expect(shop?.bookingMode).toBe('BOTH')
  })

  it('rejects invalid mode (400)', async () => {
    await request(app)
      .patch(`/api/v1/shop/${shopId}/booking-mode`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({ mode: 'INVALID' })
      .expect(400)
  })
})

// ─── Analytics plan gate (PRO required) ──────────────────────────────────────

describe('GET /dashboard/analytics (PRO gate)', () => {
  it('blocks FREE shop (403 plan_required)', async () => {
    const res = await request(app)
      .get('/api/v1/dashboard/analytics')
      .set('Authorization', `Bearer ${ownerToken}`)
    expect(res.status).toBe(403)
    expect(res.body.error).toBe('plan_required')
  })

  it('allows PRO shop through', async () => {
    await prisma.shop.update({ where: { id: shopId }, data: { plan: 'PRO' } })
    const token = signAccess({ id: ownerId, role: 'SHOP_OWNER', shopId })
    const res = await request(app)
      .get('/api/v1/dashboard/analytics')
      .set('Authorization', `Bearer ${token}`)
    expect(res.status).toBe(200)
  })
})

// ─── Booking plan gate (STARTER required) ────────────────────────────────────

describe('POST /bookings (STARTER gate)', () => {
  it('blocks booking on FREE shop (403 plan_required)', async () => {
    const service = await prisma.service.create({
      data: { shopId, nameEn: 'Cut', nameAr: 'قص', price: 5000, durationMin: 30, isActive: true, category: 'HAIR' },
    })

    const slot = new Date()
    slot.setDate(slot.getDate() + 1)
    slot.setHours(10, 0, 0, 0)

    const res = await request(app)
      .post('/api/v1/bookings')
      .set('Authorization', `Bearer ${custToken}`)
      .send({ shopId, serviceIds: [service.id], slot: slot.toISOString(), paymentMethod: 'CASH' })

    expect(res.status).toBe(403)
    expect(res.body.error).toBe('plan_required')

    await prisma.service.delete({ where: { id: service.id } })
  })
})

// ─── Barber count limit ───────────────────────────────────────────────────────

describe('POST /shops/:id/barbers (count limit)', () => {
  it('blocks second barber on FREE plan (403 plan_required)', async () => {
    await prisma.barber.create({
      data: { shopId, nameEn: 'First Barber', nameAr: 'حلاق أول' },
    })

    const res = await request(app)
      .post(`/api/v1/shops/${shopId}/barbers`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({ nameEn: 'Second Barber', nameAr: 'حلاق ثاني' })

    expect(res.status).toBe(403)
    expect(res.body.error).toBe('plan_required')

    await prisma.barber.deleteMany({ where: { shopId } })
  })

  it('allows second barber on STARTER plan', async () => {
    await prisma.shop.update({ where: { id: shopId }, data: { plan: 'STARTER' } })
    await prisma.barber.create({ data: { shopId, nameEn: 'First', nameAr: 'أول' } })

    const res = await request(app)
      .post(`/api/v1/shops/${shopId}/barbers`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({ nameEn: 'Second Barber', nameAr: 'حلاق ثاني' })

    expect(res.status).toBe(201)

    await prisma.barber.deleteMany({ where: { shopId } })
  })

  it('blocks third barber on STARTER plan', async () => {
    await prisma.shop.update({ where: { id: shopId }, data: { plan: 'STARTER' } })
    await prisma.barber.createMany({
      data: [
        { shopId, nameEn: 'First',  nameAr: 'أول' },
        { shopId, nameEn: 'Second', nameAr: 'ثاني' },
      ],
    })

    const res = await request(app)
      .post(`/api/v1/shops/${shopId}/barbers`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({ nameEn: 'Third Barber', nameAr: 'حلاق ثالث' })

    expect(res.status).toBe(403)

    await prisma.barber.deleteMany({ where: { shopId } })
  })
})
