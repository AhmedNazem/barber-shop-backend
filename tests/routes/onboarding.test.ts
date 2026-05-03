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
  uploadToS3: vi.fn().mockImplementation((key: string) => Promise.resolve(`https://cdn.example.com/${key}`)),
}))

const app = createApp({ NODE_ENV: 'test', CORS_ORIGIN: 'http://localhost:3000' })

const E164_OWNER  = '+9647900000128'
const E164_OWNER2 = '+9647900000129'
const E164_ADMIN  = '+9647900000130'

let ownerId:  string
let owner2Id: string
let adminId:  string
let ownerToken:  string
let owner2Token: string
let adminToken:  string

const basicsPayload = {
  nameEn: 'Test Barber', nameAr: 'حلاق تجريبي',
  address: 'Main St', city: 'Baghdad',
  neighborhood: 'Karrada', neighborhoodAr: 'الكرادة',
  phone: '+9641234567890', lat: 33.3, lng: 44.4,
}

beforeEach(async () => {
  await cleanupPhone(E164_OWNER)
  await cleanupPhone(E164_OWNER2)
  await cleanupPhone(E164_ADMIN)

  const owner  = await prisma.user.create({ data: { phone: E164_OWNER,  name: 'Owner',  role: 'SHOP_OWNER' } })
  const owner2 = await prisma.user.create({ data: { phone: E164_OWNER2, name: 'Owner2', role: 'SHOP_OWNER' } })
  const admin  = await prisma.user.create({ data: { phone: E164_ADMIN,  name: 'Admin',  role: 'ADMIN' } })
  ownerId  = owner.id
  owner2Id = owner2.id
  adminId  = admin.id
  ownerToken  = signAccess({ id: ownerId,  role: 'SHOP_OWNER', shopId: undefined })
  owner2Token = signAccess({ id: owner2Id, role: 'SHOP_OWNER', shopId: undefined })
  adminToken  = signAccess({ id: adminId,  role: 'ADMIN',      shopId: undefined })
})

afterEach(async () => {
  const shops = await prisma.shop.findMany({ where: { ownerId: { in: [ownerId, owner2Id] } } })
  const shopIds = shops.map(s => s.id)
  await prisma.notification.deleteMany({ where: { userId: { in: [ownerId, owner2Id, adminId] } } })
  await prisma.businessHours.deleteMany({ where: { shopId: { in: shopIds } } })
  await prisma.service.deleteMany({ where: { shopId: { in: shopIds } } })
  await prisma.booking.deleteMany({ where: { shopId: { in: shopIds } } })
  await prisma.shop.deleteMany({ where: { id: { in: shopIds } } })
  await cleanupPhone(E164_OWNER)
  await cleanupPhone(E164_OWNER2)
  await cleanupPhone(E164_ADMIN)
})

// ── POST /onboarding/basics ───────────────────────────────────────────────────

describe('POST /api/v1/onboarding/basics', () => {
  it('creates a shop and returns shopId', async () => {
    const res = await request(app)
      .post('/api/v1/onboarding/basics')
      .set('Authorization', `Bearer ${ownerToken}`)
      .send(basicsPayload)

    expect(res.status).toBe(200)
    expect(res.body.data.shopId).toBeDefined()

    const shop = await prisma.shop.findFirst({ where: { ownerId } })
    expect(shop).not.toBeNull()
    expect(shop!.nameEn).toBe('Test Barber')
    expect(shop!.status).toBe('PENDING')
  })

  it('links User.shopId after shop creation', async () => {
    const res = await request(app)
      .post('/api/v1/onboarding/basics')
      .set('Authorization', `Bearer ${ownerToken}`)
      .send(basicsPayload)

    const user = await prisma.user.findUnique({ where: { id: ownerId } })
    expect(user!.shopId).toBe(res.body.data.shopId)
  })

  it('returns 409 when owner already has a non-rejected shop', async () => {
    // First submission
    await request(app)
      .post('/api/v1/onboarding/basics')
      .set('Authorization', `Bearer ${ownerToken}`)
      .send(basicsPayload)

    // Second submission — shop is PENDING, should conflict
    const res = await request(app)
      .post('/api/v1/onboarding/basics')
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({ ...basicsPayload, nameEn: 'Updated Name' })

    expect(res.status).toBe(409)
  })

  it('S11.6 — upserts basics when shop is REJECTED', async () => {
    const shop = await prisma.shop.create({
      data: {
        ownerId, nameEn: 'Old', nameAr: 'قديم', address: 'St', city: 'Baghdad',
        neighborhood: 'K', neighborhoodAr: 'ك', phone: '+964111', lat: 0, lng: 0,
        status: 'REJECTED',
      },
    })

    const res = await request(app)
      .post('/api/v1/onboarding/basics')
      .set('Authorization', `Bearer ${ownerToken}`)
      .send(basicsPayload)

    expect(res.status).toBe(200)
    expect(res.body.data.shopId).toBe(shop.id)

    const updated = await prisma.shop.findUnique({ where: { id: shop.id } })
    expect(updated!.nameEn).toBe('Test Barber')
  })
})

// ── POST /onboarding/services ─────────────────────────────────────────────────

describe('POST /api/v1/onboarding/services', () => {
  it('replaces all services for the shop', async () => {
    await request(app)
      .post('/api/v1/onboarding/basics')
      .set('Authorization', `Bearer ${ownerToken}`)
      .send(basicsPayload)

    await request(app)
      .post('/api/v1/onboarding/services')
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({ services: [
        { nameEn: 'Haircut', nameAr: 'قص', category: 'hair', price: 5000, durationMin: 30 },
        { nameEn: 'Beard',   nameAr: 'لحية', category: 'beard', price: 3000, durationMin: 20 },
      ]})

    // Replace with only one service
    const res = await request(app)
      .post('/api/v1/onboarding/services')
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({ services: [
        { nameEn: 'Cut Only', nameAr: 'قص فقط', category: 'hair', price: 4000, durationMin: 25 },
      ]})

    expect(res.status).toBe(200)
    expect(res.body.data).toHaveLength(1)
    expect(res.body.data[0].nameEn).toBe('Cut Only')
  })
})

// ── POST /onboarding/hours ────────────────────────────────────────────────────

describe('POST /api/v1/onboarding/hours', () => {
  it('S0.5-H — maps 3-letter day keys to dayOfWeek integers', async () => {
    await request(app)
      .post('/api/v1/onboarding/basics')
      .set('Authorization', `Bearer ${ownerToken}`)
      .send(basicsPayload)

    const res = await request(app)
      .post('/api/v1/onboarding/hours')
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({
        mon: { closed: false, open: '09:00', close: '18:00' },
        tue: { closed: false, open: '09:00', close: '18:00' },
        wed: { closed: false, open: '09:00', close: '18:00' },
        thu: { closed: false, open: '09:00', close: '18:00' },
        fri: { closed: true,  open: '00:00', close: '00:00' },
        sat: { closed: false, open: '10:00', close: '16:00' },
        sun: { closed: false, open: '10:00', close: '16:00' },
      })

    expect(res.status).toBe(200)
    expect(res.body.data).toHaveLength(7)

    const monRow = res.body.data.find((h: { dayOfWeek: number }) => h.dayOfWeek === 1)
    expect(monRow.openTime).toBe('09:00')
    expect(monRow.isClosed).toBe(false)

    const sunRow = res.body.data.find((h: { dayOfWeek: number }) => h.dayOfWeek === 0)
    expect(sunRow).toBeDefined()
  })
})

// ── POST /onboarding/submit ───────────────────────────────────────────────────

describe('POST /api/v1/onboarding/submit', () => {
  it('sets shop status to PENDING and notifies admins', async () => {
    await request(app)
      .post('/api/v1/onboarding/basics')
      .set('Authorization', `Bearer ${ownerToken}`)
      .send(basicsPayload)

    const res = await request(app)
      .post('/api/v1/onboarding/submit')
      .set('Authorization', `Bearer ${ownerToken}`)

    expect(res.status).toBe(200)
    expect(res.body.data.ok).toBe(true)

    const adminNotif = await prisma.notification.findFirst({
      where: { userId: adminId, type: 'SYSTEM_ALERT' },
    })
    expect(adminNotif).not.toBeNull()
  })
})

// ── Admin approval/rejection/suspension ──────────────────────────────────────

describe('PATCH /api/v1/admin/shops/:id/approve', () => {
  it('sets shop status to APPROVED and notifies owner', async () => {
    const shop = await prisma.shop.create({
      data: {
        ownerId, nameEn: 'Shop', nameAr: 'محل', address: 'St', city: 'Baghdad',
        neighborhood: 'K', neighborhoodAr: 'ك', phone: '+964111', lat: 0, lng: 0,
        status: 'PENDING',
      },
    })

    const res = await request(app)
      .patch(`/api/v1/admin/shops/${shop.id}/approve`)
      .set('Authorization', `Bearer ${adminToken}`)

    expect(res.status).toBe(200)

    const updated = await prisma.shop.findUnique({ where: { id: shop.id } })
    expect(updated!.status).toBe('APPROVED')
    expect(updated!.isActive).toBe(true)

    const notif = await prisma.notification.findFirst({ where: { userId: ownerId, type: 'SYSTEM_ALERT' } })
    expect(notif).not.toBeNull()
  })

  it('returns 403 for non-admin', async () => {
    const shop = await prisma.shop.create({
      data: {
        ownerId, nameEn: 'Shop', nameAr: 'محل', address: 'St', city: 'Baghdad',
        neighborhood: 'K', neighborhoodAr: 'ك', phone: '+964111', lat: 0, lng: 0,
      },
    })

    const res = await request(app)
      .patch(`/api/v1/admin/shops/${shop.id}/approve`)
      .set('Authorization', `Bearer ${ownerToken}`)

    expect(res.status).toBe(403)
  })
})

describe('PATCH /api/v1/admin/shops/:id/reject', () => {
  it('sets shop status to REJECTED with reason and notifies owner', async () => {
    const shop = await prisma.shop.create({
      data: {
        ownerId, nameEn: 'Shop', nameAr: 'محل', address: 'St', city: 'Baghdad',
        neighborhood: 'K', neighborhoodAr: 'ك', phone: '+964111', lat: 0, lng: 0,
      },
    })

    const res = await request(app)
      .patch(`/api/v1/admin/shops/${shop.id}/reject`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ reason: 'Missing documents', reasonAr: 'وثائق ناقصة' })

    expect(res.status).toBe(200)

    const updated = await prisma.shop.findUnique({ where: { id: shop.id } })
    expect(updated!.status).toBe('REJECTED')
    expect(updated!.rejectionReason).toBe('Missing documents')
  })
})

describe('PATCH /api/v1/admin/shops/:id/suspend — S11.7', () => {
  it('suspends shop, cancels UPCOMING bookings (S0.5-D), notifies customers and owner', async () => {
    const shop = await prisma.shop.create({
      data: {
        ownerId, nameEn: 'Shop', nameAr: 'محل', address: 'St', city: 'Baghdad',
        neighborhood: 'K', neighborhoodAr: 'ك', phone: '+964111', lat: 0, lng: 0,
        status: 'APPROVED', isActive: true,
      },
    })

    const customer = await prisma.user.create({ data: { phone: '+9647900000195', name: 'Customer', role: 'CUSTOMER' } })
    const service  = await prisma.service.create({
      data: { shopId: shop.id, nameEn: 'Cut', nameAr: 'قص', price: 5000, durationMin: 30, category: 'hair' },
    })
    const booking = await prisma.booking.create({
      data: {
        customerId: customer.id, shopId: shop.id,
        slot: new Date(Date.now() + 24 * 60 * 60 * 1000),
        totalPrice: 5000, depositPaid: 0, paymentMethod: 'ZAINCASH', status: 'UPCOMING',
        services: { create: [{ serviceId: service.id, nameEn: 'Cut', nameAr: 'قص', price: 5000, durationMin: 30 }] },
      },
    })

    const res = await request(app)
      .patch(`/api/v1/admin/shops/${shop.id}/suspend`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ reason: 'Policy violation' })

    expect(res.status).toBe(200)

    const updatedShop = await prisma.shop.findUnique({ where: { id: shop.id } })
    expect(updatedShop!.status).toBe('SUSPENDED')
    expect(updatedShop!.isActive).toBe(false)

    const cancelledBooking = await prisma.booking.findUnique({ where: { id: booking.id } })
    expect(cancelledBooking!.status).toBe('CANCELLED')
    expect(cancelledBooking!.cancellationReason).toBe('shop_suspended')

    const customerNotif = await prisma.notification.findFirst({ where: { userId: customer.id, type: 'CANCELLATION' } })
    expect(customerNotif).not.toBeNull()

    const ownerNotif = await prisma.notification.findFirst({ where: { userId: ownerId, type: 'SYSTEM_ALERT' } })
    expect(ownerNotif).not.toBeNull()

    // cleanup extra user
    await prisma.notification.deleteMany({ where: { userId: customer.id } })
    await prisma.user.deleteMany({ where: { id: customer.id } })
  })
})
