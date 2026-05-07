import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import request from 'supertest'
import { createApp } from '@/app'
import { prisma } from '@/config/prisma'
import { signAccess } from '@/lib/jwt'
import { cleanupPhone } from '../helpers/auth'

// ─── Mocks ────────────────────────────────────────────────────────────────────

vi.mock('@/jobs/contact-email.worker', () => ({
  contactEmailQueue: { add: vi.fn().mockResolvedValue({ id: 'email-job-1' }) },
}))

// ─── Setup ────────────────────────────────────────────────────────────────────

const app = createApp({ NODE_ENV: 'test', CORS_ORIGIN: 'http://localhost:3000' })

const E164_CUST = '+9647900000144'
let custId: string
let custToken: string

// A fake shopId to use in saved-shops tests
const SHOP_ID = 'cltest000000000000000000001'

beforeEach(async () => {
  await cleanupPhone(E164_CUST)
  const cust = await prisma.user.create({ data: { phone: E164_CUST, name: 'Cust S17', role: 'CUSTOMER' } })
  custId    = cust.id
  custToken = signAccess({ id: custId, role: 'CUSTOMER', shopId: undefined })
})

afterEach(async () => {
  await prisma.savedShop.deleteMany({ where: { userId: custId } })
  await prisma.contactMessage.deleteMany({ where: { email: 'test@example.com' } })
  await cleanupPhone(E164_CUST)
})

// ─── POST /contact ────────────────────────────────────────────────────────────

describe('POST /contact', () => {
  const valid = {
    name:    'Ali Hassan',
    email:   'test@example.com',
    subject: 'general',
    message: 'Hello from test',
  }

  it('persists contact message and returns 201 with id', async () => {
    const res = await request(app)
      .post('/api/v1/contact')
      .send(valid)
      .expect(201)

    expect(res.body.data.id).toBeTruthy()

    const record = await prisma.contactMessage.findUnique({ where: { id: res.body.data.id } })
    expect(record).not.toBeNull()
    expect(record?.name).toBe('Ali Hassan')
    expect(record?.subject).toBe('general')
  })

  it('accepts all valid subject values', async () => {
    const subjects = ['general', 'booking', 'partnership', 'technical', 'complaint'] as const
    for (const subject of subjects) {
      const res = await request(app)
        .post('/api/v1/contact')
        .send({ ...valid, subject })
        .expect(201)
      expect(res.body.data.id).toBeTruthy()
    }
  })

  it('rejects invalid subject (400)', async () => {
    await request(app)
      .post('/api/v1/contact')
      .send({ ...valid, subject: 'support' })
      .expect(400)
  })

  it('rejects invalid email (400)', async () => {
    await request(app)
      .post('/api/v1/contact')
      .send({ ...valid, email: 'not-an-email' })
      .expect(400)
  })

  it('rejects missing name (400)', async () => {
    const { name: _, ...body } = valid
    await request(app)
      .post('/api/v1/contact')
      .send(body)
      .expect(400)
  })
})

// ─── GET /account/saved-shops ─────────────────────────────────────────────────

describe('GET /account/saved-shops', () => {
  it('returns empty array when no saved shops', async () => {
    const res = await request(app)
      .get('/api/v1/account/saved-shops')
      .set('Authorization', `Bearer ${custToken}`)
      .expect(200)

    expect(res.body.data).toEqual([])
  })

  it('returns saved shops for customer', async () => {
    await prisma.savedShop.create({ data: { userId: custId, shopId: SHOP_ID } })

    const res = await request(app)
      .get('/api/v1/account/saved-shops')
      .set('Authorization', `Bearer ${custToken}`)
      .expect(200)

    expect(res.body.data).toHaveLength(1)
    expect(res.body.data[0].shopId).toBe(SHOP_ID)
  })

  it('requires authentication (401)', async () => {
    await request(app)
      .get('/api/v1/account/saved-shops')
      .expect(401)
  })
})

// ─── POST /account/saved-shops/:shopId ───────────────────────────────────────

describe('POST /account/saved-shops/:shopId', () => {
  it('saves a shop and returns 201', async () => {
    const res = await request(app)
      .post(`/api/v1/account/saved-shops/${SHOP_ID}`)
      .set('Authorization', `Bearer ${custToken}`)
      .expect(201)

    expect(res.body.data.saved).toBe(true)

    const record = await prisma.savedShop.findUnique({
      where: { userId_shopId: { userId: custId, shopId: SHOP_ID } },
    })
    expect(record).not.toBeNull()
  })

  it('duplicate save is idempotent — returns 201 both times', async () => {
    await request(app)
      .post(`/api/v1/account/saved-shops/${SHOP_ID}`)
      .set('Authorization', `Bearer ${custToken}`)
      .expect(201)

    await request(app)
      .post(`/api/v1/account/saved-shops/${SHOP_ID}`)
      .set('Authorization', `Bearer ${custToken}`)
      .expect(201)

    const count = await prisma.savedShop.count({ where: { userId: custId, shopId: SHOP_ID } })
    expect(count).toBe(1)
  })

  it('requires authentication (401)', async () => {
    await request(app)
      .post(`/api/v1/account/saved-shops/${SHOP_ID}`)
      .expect(401)
  })
})

// ─── DELETE /account/saved-shops/:shopId ─────────────────────────────────────

describe('DELETE /account/saved-shops/:shopId', () => {
  it('removes a saved shop and returns 204', async () => {
    await prisma.savedShop.create({ data: { userId: custId, shopId: SHOP_ID } })

    await request(app)
      .delete(`/api/v1/account/saved-shops/${SHOP_ID}`)
      .set('Authorization', `Bearer ${custToken}`)
      .expect(204)

    const record = await prisma.savedShop.findUnique({
      where: { userId_shopId: { userId: custId, shopId: SHOP_ID } },
    })
    expect(record).toBeNull()
  })

  it('deleting non-existent saved shop returns 204 (idempotent)', async () => {
    await request(app)
      .delete(`/api/v1/account/saved-shops/${SHOP_ID}`)
      .set('Authorization', `Bearer ${custToken}`)
      .expect(204)
  })

  it('requires authentication (401)', async () => {
    await request(app)
      .delete(`/api/v1/account/saved-shops/${SHOP_ID}`)
      .expect(401)
  })
})
