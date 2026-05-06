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

const E164_CUST  = '+9647900000137'
const E164_ADMIN = '+9647900000138'
const E164_CUST2 = '+9647900000139'

let custId:  string
let adminId: string
let cust2Id: string
let custToken:  string
let adminToken: string
let cust2Token: string

beforeEach(async () => {
  await cleanupPhone(E164_CUST)
  await cleanupPhone(E164_ADMIN)
  await cleanupPhone(E164_CUST2)

  const cust  = await prisma.user.create({ data: { phone: E164_CUST,  name: 'Cust',   role: 'CUSTOMER' } })
  const admin = await prisma.user.create({ data: { phone: E164_ADMIN, name: 'Admin',  role: 'ADMIN'    } })
  const cust2 = await prisma.user.create({ data: { phone: E164_CUST2, name: 'Cust2',  role: 'CUSTOMER' } })

  custId  = cust.id
  adminId = admin.id
  cust2Id = cust2.id

  custToken  = signAccess({ id: custId,  role: 'CUSTOMER', shopId: undefined })
  adminToken = signAccess({ id: adminId, role: 'ADMIN',    shopId: undefined })
  cust2Token = signAccess({ id: cust2Id, role: 'CUSTOMER', shopId: undefined })
})

afterEach(async () => {
  await prisma.loyaltyTransaction.deleteMany({ where: { userId: { in: [custId, cust2Id] } } })
  await prisma.loyaltyAccount.deleteMany({ where: { userId: { in: [custId, cust2Id] } } })
  await prisma.reliabilityRecord.deleteMany({ where: { userId: { in: [custId, cust2Id] } } })
  await prisma.hairAnalysisHistory.deleteMany({ where: { userId: custId } })
  await prisma.hairProfile.deleteMany({ where: { userId: custId } })
  await cleanupPhone(E164_CUST)
  await cleanupPhone(E164_ADMIN)
  await cleanupPhone(E164_CUST2)
})

// ─── Loyalty ──────────────────────────────────────────────────────────────────

describe('GET /user/loyalty', () => {
  it('returns BRONZE with 0 points for new user', async () => {
    const res = await request(app)
      .get('/api/v1/user/loyalty')
      .set('Authorization', `Bearer ${custToken}`)
      .expect(200)

    expect(res.body.data.points).toBe(0)
    expect(res.body.data.tier).toBe('BRONZE')
  })

  it('returns existing account', async () => {
    await prisma.loyaltyAccount.create({ data: { userId: custId, points: 150, tier: 'SILVER' } })

    const res = await request(app)
      .get('/api/v1/user/loyalty')
      .set('Authorization', `Bearer ${custToken}`)
      .expect(200)

    expect(res.body.data.points).toBe(150)
    expect(res.body.data.tier).toBe('SILVER')
  })
})

describe('earnPoints', () => {
  it('earns correct points and promotes to SILVER tier', async () => {
    const { earnPoints } = await import('@/services/loyalty.service')

    // 100,000 IQD → 100 points → SILVER
    await earnPoints(custId, 100_000)

    const account = await prisma.loyaltyAccount.findUnique({ where: { userId: custId } })
    expect(account?.points).toBe(100)
    expect(account?.tier).toBe('SILVER')
  })

  it('earns 0 points for price < 1000', async () => {
    const { earnPoints } = await import('@/services/loyalty.service')
    await earnPoints(custId, 500)

    const account = await prisma.loyaltyAccount.findUnique({ where: { userId: custId } })
    expect(account).toBeNull()
  })

  it('auto-grants VIP at GOLD tier (500 pts)', async () => {
    const { earnPoints } = await import('@/services/loyalty.service')

    await earnPoints(custId, 500_000) // 500 pts

    const account = await prisma.loyaltyAccount.findUnique({ where: { userId: custId } })
    const user    = await prisma.user.findUnique({ where: { id: custId } })
    expect(account?.tier).toBe('GOLD')
    expect(user?.isVip).toBe(true)
    expect(user?.vipGrantedAt).not.toBeNull()
  })

  it('is idempotent — repeated earn accumulates correctly', async () => {
    const { earnPoints } = await import('@/services/loyalty.service')
    await earnPoints(custId, 50_000) // 50 pts
    await earnPoints(custId, 50_000) // 50 pts
    await earnPoints(custId, 50_000) // 50 pts

    const account = await prisma.loyaltyAccount.findUnique({ where: { userId: custId } })
    expect(account?.points).toBe(150)
    expect(account?.tier).toBe('SILVER')
  })
})

describe('POST /user/loyalty/redeem', () => {
  let rewardId: string

  beforeEach(async () => {
    const reward = await prisma.loyaltyReward.create({
      data: { nameEn: 'Free Cut', nameAr: 'قص مجاني', pointsCost: 50, discountIQD: 5000 },
    })
    rewardId = reward.id
    await prisma.loyaltyAccount.create({ data: { userId: custId, points: 100, tier: 'SILVER' } })
  })

  afterEach(async () => {
    await prisma.loyaltyReward.deleteMany({ where: { id: rewardId } })
  })

  it('redeems reward and deducts points', async () => {
    await request(app)
      .post('/api/v1/user/loyalty/redeem')
      .set('Authorization', `Bearer ${custToken}`)
      .send({ rewardId })
      .expect(200)

    const account = await prisma.loyaltyAccount.findUnique({ where: { userId: custId } })
    expect(account?.points).toBe(50)
  })

  it('rejects redemption when insufficient points (422)', async () => {
    await prisma.loyaltyAccount.update({ where: { userId: custId }, data: { points: 10 } })

    const res = await request(app)
      .post('/api/v1/user/loyalty/redeem')
      .set('Authorization', `Bearer ${custToken}`)
      .send({ rewardId })

    expect(res.status).toBe(422)
    expect(res.body.error).toBe('insufficient_points')
  })
})

// ─── Reliability ──────────────────────────────────────────────────────────────

describe('GET /user/reliability', () => {
  it('returns score 100 for new user', async () => {
    const res = await request(app)
      .get('/api/v1/user/reliability')
      .set('Authorization', `Bearer ${custToken}`)
      .expect(200)

    expect(res.body.data.score).toBe(100)
    expect(res.body.data.isBlocked).toBe(false)
  })

  it('returns existing record', async () => {
    await prisma.reliabilityRecord.create({ data: { userId: custId, score: 40, noShowCount: 3 } })

    const res = await request(app)
      .get('/api/v1/user/reliability')
      .set('Authorization', `Bearer ${custToken}`)
      .expect(200)

    expect(res.body.data.score).toBe(40)
    expect(res.body.data.isBlocked).toBe(true)
    expect(res.body.data.noShowCount).toBe(3)
  })
})

describe('applyReliabilityEvent', () => {
  it('applies NO_SHOW: score -20, noShowCount +1', async () => {
    const { applyReliabilityEvent } = await import('@/services/reliability.service')
    await applyReliabilityEvent(custId, 'NO_SHOW')

    const record = await prisma.reliabilityRecord.findUnique({ where: { userId: custId } })
    expect(record?.score).toBe(80)
    expect(record?.noShowCount).toBe(1)
  })

  it('clamps score at 0 (does not go negative)', async () => {
    const { applyReliabilityEvent } = await import('@/services/reliability.service')
    await prisma.reliabilityRecord.create({ data: { userId: custId, score: 5, noShowCount: 0 } })
    await applyReliabilityEvent(custId, 'NO_SHOW')

    const record = await prisma.reliabilityRecord.findUnique({ where: { userId: custId } })
    expect(record?.score).toBe(0)
  })

  it('clamps score at 100 (does not exceed max)', async () => {
    const { applyReliabilityEvent } = await import('@/services/reliability.service')
    await prisma.reliabilityRecord.create({ data: { userId: custId, score: 98, noShowCount: 0 } })
    await applyReliabilityEvent(custId, 'COMPLETION')

    const record = await prisma.reliabilityRecord.findUnique({ where: { userId: custId } })
    expect(record?.score).toBe(100)
  })
})

// ─── Admin: unblock + VIP ─────────────────────────────────────────────────────

describe('POST /admin/users/:id/unblock', () => {
  it('resets blocked user score to 60', async () => {
    await prisma.reliabilityRecord.create({ data: { userId: custId, score: 20, noShowCount: 5 } })

    await request(app)
      .post(`/api/v1/admin/users/${custId}/unblock`)
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200)

    const record = await prisma.reliabilityRecord.findUnique({ where: { userId: custId } })
    expect(record?.score).toBe(60)
    expect(record?.noShowCount).toBe(0)
  })
})

describe('POST /admin/users/:id/vip', () => {
  it('grants VIP status to user', async () => {
    await request(app)
      .post(`/api/v1/admin/users/${custId}/vip`)
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200)

    const user = await prisma.user.findUnique({ where: { id: custId } })
    expect(user?.isVip).toBe(true)
    expect(user?.vipGrantedBy).toBe(adminId)
  })
})

// ─── Hair Profile ─────────────────────────────────────────────────────────────

describe('PUT /user/hair-profile', () => {
  it('creates hair profile', async () => {
    const res = await request(app)
      .put('/api/v1/user/hair-profile')
      .set('Authorization', `Bearer ${custToken}`)
      .send({
        dryness: 3, damage: 2, scalpCondition: 'normal',
        cutFrequencyWeeks: 4, lastTreatmentDate: '2026-01-01',
      })
      .expect(200)

    expect(res.body.data.dryness).toBe(3)
    expect(res.body.data.scalpCondition).toBe('normal')
  })

  it('rejects invalid dryness out of range (400)', async () => {
    await request(app)
      .put('/api/v1/user/hair-profile')
      .set('Authorization', `Bearer ${custToken}`)
      .send({ dryness: 6, damage: 2, scalpCondition: 'normal', cutFrequencyWeeks: 4 })
      .expect(400)
  })
})

describe('GET /user/hair-profile', () => {
  it('returns 404 when no profile exists', async () => {
    await request(app)
      .get('/api/v1/user/hair-profile')
      .set('Authorization', `Bearer ${custToken}`)
      .expect(404)
  })

  it('returns profile after creation', async () => {
    await prisma.hairProfile.create({
      data: { userId: custId, dryness: 1, damage: 1, scalpCondition: 'oily', cutFrequencyWeeks: 3 },
    })

    const res = await request(app)
      .get('/api/v1/user/hair-profile')
      .set('Authorization', `Bearer ${custToken}`)
      .expect(200)

    expect(res.body.data.scalpCondition).toBe('oily')
  })
})

describe('GET /user/hair-history', () => {
  it('returns empty array when no history', async () => {
    const res = await request(app)
      .get('/api/v1/user/hair-history')
      .set('Authorization', `Bearer ${custToken}`)
      .expect(200)

    expect(res.body.data).toEqual([])
  })
})

// ─── VIP endpoint ─────────────────────────────────────────────────────────────

describe('GET /user/vip', () => {
  it('returns isVip false for normal user', async () => {
    const res = await request(app)
      .get('/api/v1/user/vip')
      .set('Authorization', `Bearer ${custToken}`)
      .expect(200)

    expect(res.body.data.isVip).toBe(false)
  })
})
