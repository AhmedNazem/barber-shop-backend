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

const E164_OWNER  = '+9647900000140'
const E164_OWNER2 = '+9647900000141'
const E164_CUST   = '+9647900000142'

let ownerId:  string
let owner2Id: string
let custId:   string
let shopId:   string
let ownerToken:  string
let owner2Token: string
let custToken:   string

function futureDate(hours = 24): string {
  return new Date(Date.now() + hours * 60 * 60 * 1000).toISOString()
}

beforeEach(async () => {
  // Wipe any lingering data from previous failed runs (FK order: bookingService → booking → shopDiscount → shop → user)
  const oldUsers = await prisma.user.findMany({ where: { phone: { in: [E164_OWNER, E164_OWNER2, E164_CUST] } } })
  if (oldUsers.length > 0) {
    const oldShops = await prisma.shop.findMany({ where: { ownerId: { in: oldUsers.map(u => u.id) } } })
    const oldShopIds = oldShops.map(s => s.id)
    if (oldShopIds.length > 0) {
      await prisma.bookingService.deleteMany({ where: { booking: { shopId: { in: oldShopIds } } } })
      await prisma.booking.deleteMany({ where: { shopId: { in: oldShopIds } } })
      await prisma.shopDiscount.deleteMany({ where: { shopId: { in: oldShopIds } } })
      await prisma.shop.deleteMany({ where: { id: { in: oldShopIds } } })
    }
  }
  await cleanupPhone(E164_OWNER)
  await cleanupPhone(E164_OWNER2)
  await cleanupPhone(E164_CUST)

  const owner  = await prisma.user.create({ data: { phone: E164_OWNER,  name: 'Owner',  role: 'SHOP_OWNER' } })
  const owner2 = await prisma.user.create({ data: { phone: E164_OWNER2, name: 'Owner2', role: 'SHOP_OWNER' } })
  const cust   = await prisma.user.create({ data: { phone: E164_CUST,   name: 'Cust',   role: 'CUSTOMER'   } })

  ownerId  = owner.id
  owner2Id = owner2.id
  custId   = cust.id

  const shop = await prisma.shop.create({
    data: {
      ownerId, nameEn: 'Discount Shop', nameAr: 'محل',
      address: 'Test St', city: 'Baghdad', neighborhood: 'A', neighborhoodAr: 'أ',
      phone: '+9641234567892', lat: 33.3, lng: 44.4,
      status: 'APPROVED', isActive: true, plan: 'PRO',
    },
  })
  shopId = shop.id

  ownerToken  = signAccess({ id: ownerId,  role: 'SHOP_OWNER', shopId })
  owner2Token = signAccess({ id: owner2Id, role: 'SHOP_OWNER', shopId: undefined })
  custToken   = signAccess({ id: custId,   role: 'CUSTOMER',   shopId: undefined })
})

afterEach(async () => {
  if (shopId) {
    await prisma.bookingService.deleteMany({ where: { booking: { shopId } } })
    await prisma.booking.deleteMany({ where: { shopId } })
    await prisma.shopDiscount.deleteMany({ where: { shopId } })
    await prisma.shop.deleteMany({ where: { id: shopId } })
  }
  await cleanupPhone(E164_OWNER)
  await cleanupPhone(E164_OWNER2)
  await cleanupPhone(E164_CUST)
})

// ─── GET discount ─────────────────────────────────────────────────────────────

describe('GET /shops/:id/discount', () => {
  it('returns null when no discount exists', async () => {
    const res = await request(app)
      .get(`/api/v1/shops/${shopId}/discount`)
      .expect(200)

    expect(res.body.data).toBeNull()
  })

  it('returns active discount', async () => {
    await prisma.shopDiscount.create({
      data: { shopId, pct: 20, maxUsers: 10, expiresAt: new Date(Date.now() + 86400000) },
    })

    const res = await request(app)
      .get(`/api/v1/shops/${shopId}/discount`)
      .expect(200)

    expect(res.body.data.pct).toBe(20)
    expect(res.body.data.maxUsers).toBe(10)
  })

  it('returns null for expired discount', async () => {
    await prisma.shopDiscount.create({
      data: { shopId, pct: 15, maxUsers: 5, expiresAt: new Date(Date.now() - 1000) },
    })

    const res = await request(app)
      .get(`/api/v1/shops/${shopId}/discount`)
      .expect(200)

    expect(res.body.data).toBeNull()
  })

  it('returns null when all slots claimed', async () => {
    await prisma.shopDiscount.create({
      data: { shopId, pct: 10, maxUsers: 2, slotsClaimed: 2, expiresAt: new Date(Date.now() + 86400000) },
    })

    const res = await request(app)
      .get(`/api/v1/shops/${shopId}/discount`)
      .expect(200)

    expect(res.body.data).toBeNull()
  })
})

// ─── POST discount ────────────────────────────────────────────────────────────

describe('POST /shops/:id/discount', () => {
  it('owner creates a discount', async () => {
    const res = await request(app)
      .post(`/api/v1/shops/${shopId}/discount`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({ pct: 25, maxUsers: 50, expiresAt: futureDate(48) })
      .expect(200)

    expect(res.body.data.pct).toBe(25)
    expect(res.body.data.maxUsers).toBe(50)

    const saved = await prisma.shopDiscount.findUnique({ where: { shopId } })
    expect(saved?.pct).toBe(25)
  })

  it('upserts — replaces existing discount and resets slotsClaimed', async () => {
    await prisma.shopDiscount.create({
      data: { shopId, pct: 10, maxUsers: 5, slotsClaimed: 3, expiresAt: new Date(Date.now() + 86400000) },
    })

    await request(app)
      .post(`/api/v1/shops/${shopId}/discount`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({ pct: 30, maxUsers: 20, expiresAt: futureDate(72) })
      .expect(200)

    const saved = await prisma.shopDiscount.findUnique({ where: { shopId } })
    expect(saved?.pct).toBe(30)
    expect(saved?.slotsClaimed).toBe(0)
  })

  it('blocks non-owner (403)', async () => {
    await request(app)
      .post(`/api/v1/shops/${shopId}/discount`)
      .set('Authorization', `Bearer ${owner2Token}`)
      .send({ pct: 10, maxUsers: 5, expiresAt: futureDate() })
      .expect(403)
  })

  it('rejects past expiresAt (400)', async () => {
    const pastDate = new Date(Date.now() - 1000).toISOString()
    await request(app)
      .post(`/api/v1/shops/${shopId}/discount`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({ pct: 10, maxUsers: 5, expiresAt: pastDate })
      .expect(400)
  })

  it('rejects pct > 100 (400)', async () => {
    await request(app)
      .post(`/api/v1/shops/${shopId}/discount`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({ pct: 101, maxUsers: 5, expiresAt: futureDate() })
      .expect(400)
  })
})

// ─── DELETE discount ──────────────────────────────────────────────────────────

describe('DELETE /shops/:id/discount', () => {
  it('owner deletes a discount', async () => {
    await prisma.shopDiscount.create({
      data: { shopId, pct: 10, maxUsers: 5, expiresAt: new Date(Date.now() + 86400000) },
    })

    await request(app)
      .delete(`/api/v1/shops/${shopId}/discount`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .expect(200)

    const saved = await prisma.shopDiscount.findUnique({ where: { shopId } })
    expect(saved).toBeNull()
  })

  it('returns 404 when no discount to delete', async () => {
    await request(app)
      .delete(`/api/v1/shops/${shopId}/discount`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .expect(404)
  })

  it('blocks non-owner (403)', async () => {
    await prisma.shopDiscount.create({
      data: { shopId, pct: 10, maxUsers: 5, expiresAt: new Date(Date.now() + 86400000) },
    })

    await request(app)
      .delete(`/api/v1/shops/${shopId}/discount`)
      .set('Authorization', `Bearer ${owner2Token}`)
      .expect(403)
  })
})

// ─── Discount included in GET /shops/:id ─────────────────────────────────────

describe('GET /shops/:id includes discount', () => {
  it('includes active discount in shop detail', async () => {
    await prisma.shopDiscount.create({
      data: { shopId, pct: 15, maxUsers: 100, expiresAt: new Date(Date.now() + 86400000) },
    })

    const res = await request(app)
      .get(`/api/v1/shops/${shopId}`)
      .expect(200)

    expect(res.body.data.discount).not.toBeNull()
    expect(res.body.data.discount.pct).toBe(15)
  })

  it('discount is null when not active', async () => {
    const res = await request(app)
      .get(`/api/v1/shops/${shopId}`)
      .expect(200)

    expect(res.body.data.discount).toBeNull()
  })
})
