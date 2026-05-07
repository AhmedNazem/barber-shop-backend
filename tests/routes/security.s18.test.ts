import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import request from 'supertest'
import { createApp } from '@/app'
import { prisma } from '@/config/prisma'
import { signAccess } from '@/lib/jwt'
import { cleanupPhone } from '../helpers/auth'

const app = createApp({ NODE_ENV: 'test', CORS_ORIGIN: 'http://localhost:3000' })

const E164_OWNER_A = '+9647900000145'
const E164_OWNER_B = '+9647900000146'

let shopAId: string
let shopBId: string
let ownerAToken: string
let ownerBToken: string
let pendingOwnerToken: string

beforeEach(async () => {
  await cleanupPhone(E164_OWNER_A)
  await cleanupPhone(E164_OWNER_B)

  const ownerA = await prisma.user.create({ data: { phone: E164_OWNER_A, name: 'Owner A', role: 'SHOP_OWNER' } })
  const ownerB = await prisma.user.create({ data: { phone: E164_OWNER_B, name: 'Owner B', role: 'SHOP_OWNER' } })

  const shopA = await prisma.shop.create({
    data: {
      ownerId: ownerA.id, nameEn: 'Shop A', nameAr: 'محل أ', address: 'St A', city: 'Baghdad',
      neighborhood: 'K', neighborhoodAr: 'ك', phone: '+9640000000145',
      lat: 33.34, lng: 44.40, status: 'APPROVED', isActive: true,
    },
  })
  const shopB = await prisma.shop.create({
    data: {
      ownerId: ownerB.id, nameEn: 'Shop B', nameAr: 'محل ب', address: 'St B', city: 'Baghdad',
      neighborhood: 'K', neighborhoodAr: 'ك', phone: '+9640000000146',
      lat: 33.35, lng: 44.41, status: 'APPROVED', isActive: true,
    },
  })
  const pendingShop = await prisma.shop.create({
    data: {
      ownerId: ownerA.id, nameEn: 'Pending', nameAr: 'معلق', address: 'St', city: 'Baghdad',
      neighborhood: 'K', neighborhoodAr: 'ك', phone: '+9640000000147',
      lat: 33.36, lng: 44.42, status: 'PENDING', isActive: false,
    },
  })

  shopAId = shopA.id
  shopBId = shopB.id

  ownerAToken      = signAccess({ id: ownerA.id, role: 'SHOP_OWNER', shopId: shopA.id })
  ownerBToken      = signAccess({ id: ownerB.id, role: 'SHOP_OWNER', shopId: shopB.id })
  pendingOwnerToken = signAccess({ id: ownerA.id, role: 'SHOP_OWNER', shopId: pendingShop.id })
})

afterEach(async () => {
  await prisma.shop.deleteMany({
    where: { ownerId: { in: (await prisma.user.findMany({
      where: { phone: { in: [E164_OWNER_A, E164_OWNER_B] } }, select: { id: true },
    })).map(u => u.id) } },
  })
  await cleanupPhone(E164_OWNER_A)
  await cleanupPhone(E164_OWNER_B)
})

// ─── Cross-shop access (requireOwnership) ────────────────────────────────────

describe('requireOwnership — cross-shop access', () => {
  it('owner B cannot create a service in shop A (403)', async () => {
    await request(app)
      .post(`/api/v1/shops/${shopAId}/services`)
      .set('Authorization', `Bearer ${ownerBToken}`)
      .send({ nameEn: 'Hack', nameAr: 'قرصنة', price: 1000, durationMin: 30, category: 'hair' })
      .expect(403)
  })

  it('owner A can create a service in their own shop (201)', async () => {
    const res = await request(app)
      .post(`/api/v1/shops/${shopAId}/services`)
      .set('Authorization', `Bearer ${ownerAToken}`)
      .send({ nameEn: 'Haircut', nameAr: 'قص', price: 5000, durationMin: 30, category: 'hair' })
      .expect(201)
    // cleanup
    await prisma.service.deleteMany({ where: { shopId: shopAId } })
    expect(res.body.data.nameEn).toBe('Haircut')
  })

  it('owner B cannot add a barber to shop A (403)', async () => {
    await request(app)
      .post(`/api/v1/shops/${shopAId}/barbers`)
      .set('Authorization', `Bearer ${ownerBToken}`)
      .send({ nameEn: 'Attacker', nameAr: 'مهاجم' })
      .expect(403)
  })
})

// ─── PENDING shop blocked from dashboard (requireShopStatus) ─────────────────

describe('requireShopStatus — PENDING shop blocked from dashboard', () => {
  it('PENDING shop owner gets 403 on GET /dashboard/stats', async () => {
    const res = await request(app)
      .get('/api/v1/dashboard/stats')
      .set('Authorization', `Bearer ${pendingOwnerToken}`)
      .expect(403)

    expect(res.body.error).toBe('shop_pending')
  })

  it('PENDING shop owner gets 403 on GET /dashboard/activity', async () => {
    const res = await request(app)
      .get('/api/v1/dashboard/activity')
      .set('Authorization', `Bearer ${pendingOwnerToken}`)
      .expect(403)

    expect(res.body.error).toBe('shop_pending')
  })

  it('APPROVED shop owner can access dashboard (200)', async () => {
    await request(app)
      .get('/api/v1/dashboard/stats')
      .set('Authorization', `Bearer ${ownerAToken}`)
      .expect(200)
  })
})
