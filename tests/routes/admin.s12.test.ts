import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import request from 'supertest'
import { createApp } from '@/app'
import { prisma } from '@/config/prisma'
import { redisClient } from '@/lib/redis'
import { signAccess } from '@/lib/jwt'
import { cleanupPhone } from '../helpers/auth'
import { decrypt } from '@/lib/crypto'

const app = createApp({ NODE_ENV: 'test', CORS_ORIGIN: 'http://localhost:3000' })

const E164_ADMIN    = '+9647900000131'
const E164_CUSTOMER = '+9647900000132'
const E164_OWNER    = '+9647900000133'

let adminId:    string
let customerId: string
let ownerId:    string
let adminToken:    string
let customerToken: string

beforeEach(async () => {
  await cleanupPhone(E164_ADMIN)
  await cleanupPhone(E164_CUSTOMER)
  await cleanupPhone(E164_OWNER)
  await prisma.platformConfig.deleteMany({ where: { id: 'singleton' } })
  await redisClient.del('platform:maintenance')

  const admin    = await prisma.user.create({ data: { phone: E164_ADMIN,    name: 'Admin',    role: 'ADMIN' } })
  const customer = await prisma.user.create({ data: { phone: E164_CUSTOMER, name: 'Customer', role: 'CUSTOMER' } })
  const owner    = await prisma.user.create({ data: { phone: E164_OWNER,    name: 'Owner',    role: 'SHOP_OWNER' } })

  adminId    = admin.id
  customerId = customer.id
  ownerId    = owner.id

  adminToken    = signAccess({ id: adminId,    role: 'ADMIN',    shopId: undefined })
  customerToken = signAccess({ id: customerId, role: 'CUSTOMER', shopId: undefined })
})

afterEach(async () => {
  await cleanupPhone(E164_ADMIN)
  await cleanupPhone(E164_CUSTOMER)
  await cleanupPhone(E164_OWNER)
  await prisma.platformConfig.deleteMany({ where: { id: 'singleton' } })
  await redisClient.del('platform:maintenance')
})

// ─── Platform config ──────────────────────────────────────────────────────────

describe('GET /admin/platform-config', () => {
  it('returns defaults when no config exists', async () => {
    const res = await request(app)
      .get('/api/v1/admin/platform-config')
      .set('Authorization', `Bearer ${adminToken}`)

    expect(res.status).toBe(200)
    expect(res.body.data.maintenanceMode).toBe(false)
    expect(res.body.data.defaultDepositPercent).toBe(20)
    expect(res.body.data.smsApiKeyMasked).toBeNull()
  })

  it('blocks non-admin (403)', async () => {
    const res = await request(app)
      .get('/api/v1/admin/platform-config')
      .set('Authorization', `Bearer ${customerToken}`)
    expect(res.status).toBe(403)
  })
})

describe('PATCH /admin/platform-config', () => {
  it('updates config and masks smsApiKey in GET response', async () => {
    await request(app)
      .patch('/api/v1/admin/platform-config')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ maintenanceMode: true, smsApiKey: 'mysecretkey123', smsSenderId: 'BarberOS' })
      .expect(200)

    const get = await request(app)
      .get('/api/v1/admin/platform-config')
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200)

    expect(get.body.data.maintenanceMode).toBe(true)
    expect(get.body.data.smsApiKeyMasked).toBe('****')
    expect(get.body.data.smsSenderId).toBe('BarberOS')

    // Verify raw key is encrypted (not stored as plaintext)
    const row = await prisma.platformConfig.findUnique({ where: { id: 'singleton' } })
    expect(row?.smsApiKeyEncrypted).not.toBe('mysecretkey123')
    expect(decrypt(row!.smsApiKeyEncrypted!)).toBe('mysecretkey123')
  })

  it('invalidates Redis cache on update', async () => {
    await redisClient.set('platform:maintenance', '1', 'EX', 30)

    await request(app)
      .patch('/api/v1/admin/platform-config')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ maintenanceMode: false })
      .expect(200)

    const cached = await redisClient.get('platform:maintenance')
    expect(cached).toBeNull()
  })
})

// ─── User listing & detail ────────────────────────────────────────────────────

describe('GET /admin/users', () => {
  it('returns paginated user list', async () => {
    const res = await request(app)
      .get('/api/v1/admin/users')
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200)

    expect(Array.isArray(res.body.data.users)).toBe(true)
    expect(typeof res.body.data.total).toBe('number')
  })

  it('filters by role', async () => {
    const res = await request(app)
      .get('/api/v1/admin/users?role=ADMIN')
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200)

    expect(res.body.data.users.every((u: { role: string }) => u.role === 'ADMIN')).toBe(true)
  })
})

describe('GET /admin/users/:id', () => {
  it('returns user detail', async () => {
    const res = await request(app)
      .get(`/api/v1/admin/users/${customerId}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200)

    expect(res.body.data.id).toBe(customerId)
    expect(res.body.data.role).toBe('CUSTOMER')
  })
})

// ─── Role change constraints ──────────────────────────────────────────────────

describe('PATCH /admin/users/:id/role', () => {
  it('blocks CUSTOMER → BARBER (must use invite flow)', async () => {
    const res = await request(app)
      .patch(`/api/v1/admin/users/${customerId}/role`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ role: 'BARBER' })
    expect(res.status).toBe(403)
  })

  it('blocks CUSTOMER → SHOP_OWNER (requires shop record)', async () => {
    const res = await request(app)
      .patch(`/api/v1/admin/users/${customerId}/role`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ role: 'SHOP_OWNER' })
    expect(res.status).toBe(403)
  })

  it('blocks promoting to ADMIN (DB-level only, not via API)', async () => {
    // ADMIN is not in the allowed Zod enum — rejected at validation layer (400)
    const res = await request(app)
      .patch(`/api/v1/admin/users/${customerId}/role`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ role: 'ADMIN' })
    expect(res.status).toBe(400)
  })

  it('allows CUSTOMER → CUSTOMER (no-op role change)', async () => {
    await request(app)
      .patch(`/api/v1/admin/users/${customerId}/role`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ role: 'CUSTOMER' })
      .expect(200)
  })

  it('invalidates refresh tokens on role change (S12.6)', async () => {
    await prisma.refreshToken.create({
      data: { userId: customerId, token: 'tok_test_s12', expiresAt: new Date(Date.now() + 86400000) },
    })

    await request(app)
      .patch(`/api/v1/admin/users/${customerId}/role`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ role: 'CUSTOMER' })
      .expect(200)

    const remaining = await prisma.refreshToken.count({ where: { userId: customerId } })
    expect(remaining).toBe(0)
  })
})

// ─── User suspend & soft delete ───────────────────────────────────────────────

describe('PATCH /admin/users/:id/suspend', () => {
  it('marks user as suspended', async () => {
    await request(app)
      .patch(`/api/v1/admin/users/${customerId}/suspend`)
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200)

    const user = await prisma.user.findUnique({ where: { id: customerId } })
    expect(user?.suspended).toBe(true)
  })
})

describe('DELETE /admin/users/:id', () => {
  it('anonymises PII and invalidates sessions', async () => {
    await prisma.refreshToken.create({
      data: { userId: customerId, token: 'tok_delete_s12', expiresAt: new Date(Date.now() + 86400000) },
    })

    await request(app)
      .delete(`/api/v1/admin/users/${customerId}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200)

    const user = await prisma.user.findUnique({ where: { id: customerId } })
    expect(user?.deletedAt).not.toBeNull()
    expect(user?.name).toBe('Deleted User')
    expect(user?.phone).toBe(`deleted_${customerId}`)

    const tokens = await prisma.refreshToken.count({ where: { userId: customerId } })
    expect(tokens).toBe(0)
  })

  it('returns 404 for already-deleted user', async () => {
    await prisma.user.update({ where: { id: customerId }, data: { deletedAt: new Date(), phone: `deleted_${customerId}`, name: 'Deleted User' } })

    const res = await request(app)
      .delete(`/api/v1/admin/users/${customerId}`)
      .set('Authorization', `Bearer ${adminToken}`)
    expect(res.status).toBe(404)
  })
})

// ─── Suspend preview ──────────────────────────────────────────────────────────

describe('GET /admin/shops/:id/suspend-preview', () => {
  it('returns booking counts for a shop', async () => {
    const shop = await prisma.shop.create({
      data: {
        ownerId: ownerId, nameEn: 'Preview Shop', nameAr: 'محل معاينة',
        address: 'Test St', city: 'Baghdad', neighborhood: 'A', neighborhoodAr: 'أ',
        lat: 33.3, lng: 44.4, phone: '+9641111111133', status: 'APPROVED', isActive: true,
      },
    })

    const res = await request(app)
      .get(`/api/v1/admin/shops/${shop.id}/suspend-preview`)
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200)

    expect(typeof res.body.data.activeBookings).toBe('number')
    expect(typeof res.body.data.pendingDepositsIQD).toBe('number')

    await prisma.shop.delete({ where: { id: shop.id } })
  })

  it('returns 404 for unknown shop', async () => {
    const res = await request(app)
      .get('/api/v1/admin/shops/nonexistent-shop-id/suspend-preview')
      .set('Authorization', `Bearer ${adminToken}`)
    expect(res.status).toBe(404)
  })
})
