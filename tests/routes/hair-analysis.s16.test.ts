import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import request from 'supertest'
import { createApp } from '@/app'
import { prisma } from '@/config/prisma'
import { redisClient } from '@/lib/redis'
import { signAccess } from '@/lib/jwt'
import { cleanupPhone } from '../helpers/auth'

// ─── Mocks ────────────────────────────────────────────────────────────────────

vi.mock('@/lib/s3', () => ({
  uploadToS3:    vi.fn().mockResolvedValue('https://cdn.example.com/test.jpg'),
  downloadFromS3: vi.fn().mockResolvedValue(Buffer.from('fake-image')),
}))

vi.mock('@/lib/queue', () => ({
  hairAnalysisQueue: { add: vi.fn().mockResolvedValue({ id: 'test-job-123' }) },
  notificationQueue: { add: vi.fn() },
  loyaltyQueue:      { add: vi.fn() },
  cleanupQueue:      { add: vi.fn() },
}))

vi.mock('@google/generative-ai', () => ({
  GoogleGenerativeAI: vi.fn().mockImplementation(() => ({
    getGenerativeModel: () => ({
      generateContent: vi.fn().mockResolvedValue({
        response: {
          text: () => JSON.stringify({
            hairType: 'wavy',
            conditionScore: 72,
            recommendations: ['rec_moisturize', 'rec_trim_regularly'],
            suggestedServices: ['svcHaircut', 'svcDeepConditioning'],
          }),
        },
      }),
    }),
  })),
}))

// ─── Setup ────────────────────────────────────────────────────────────────────

const app = createApp({ NODE_ENV: 'test', CORS_ORIGIN: 'http://localhost:3000' })

const E164_CUST = '+9647900000143'
let custId: string
let custToken: string

beforeEach(async () => {
  await cleanupPhone(E164_CUST)
  const cust = await prisma.user.create({ data: { phone: E164_CUST, name: 'Cust', role: 'CUSTOMER' } })
  custId    = cust.id
  custToken = signAccess({ id: custId, role: 'CUSTOMER', shopId: undefined })
})

afterEach(async () => {
  await prisma.hairAnalysisHistory.deleteMany({ where: { userId: custId } })
  await prisma.hairAnalysis.deleteMany({ where: { userId: custId } })
  await prisma.hairProfile.deleteMany({ where: { userId: custId } })
  await redisClient.del('hair-analysis:test-job-123')
  await cleanupPhone(E164_CUST)
})

// ─── POST /hair-analysis ─────────────────────────────────────────────────────

describe('POST /hair-analysis', () => {
  it('returns 202 with jobId on valid image upload', async () => {
    const res = await request(app)
      .post('/api/v1/hair-analysis')
      .set('Authorization', `Bearer ${custToken}`)
      .attach('image', Buffer.from('fake-image-data'), { filename: 'hair.jpg', contentType: 'image/jpeg' })

    expect(res.status).toBe(202)
    expect(res.body.data.jobId).toBe('test-job-123')
  })

  it('creates HairAnalysis DB record with processing status', async () => {
    await request(app)
      .post('/api/v1/hair-analysis')
      .set('Authorization', `Bearer ${custToken}`)
      .attach('image', Buffer.from('fake-image-data'), { filename: 'hair.jpg', contentType: 'image/jpeg' })

    const record = await prisma.hairAnalysis.findFirst({ where: { userId: custId } })
    expect(record).not.toBeNull()
    expect(record?.status).toBe('processing')
  })

  it('auto-creates HairProfile if not set', async () => {
    await request(app)
      .post('/api/v1/hair-analysis')
      .set('Authorization', `Bearer ${custToken}`)
      .attach('image', Buffer.from('fake-image-data'), { filename: 'hair.jpg', contentType: 'image/jpeg' })

    const profile = await prisma.hairProfile.findUnique({ where: { userId: custId } })
    expect(profile).not.toBeNull()
  })

  it('rejects missing image (400)', async () => {
    await request(app)
      .post('/api/v1/hair-analysis')
      .set('Authorization', `Bearer ${custToken}`)
      .expect(400)
  })

  it('requires authentication (401)', async () => {
    await request(app)
      .post('/api/v1/hair-analysis')
      .attach('image', Buffer.from('fake'), { filename: 'hair.jpg', contentType: 'image/jpeg' })
      .expect(401)
  })
})

// ─── GET /hair-analysis/:jobId ────────────────────────────────────────────────

describe('GET /hair-analysis/:jobId', () => {
  it('returns 404 for unknown jobId', async () => {
    await request(app)
      .get('/api/v1/hair-analysis/nonexistent-job')
      .expect(404)
  })

  it('returns processing status from Redis', async () => {
    await redisClient.set('hair-analysis:test-job-123', JSON.stringify({ status: 'processing' }), 'EX', 3600)

    const res = await request(app)
      .get('/api/v1/hair-analysis/test-job-123')
      .expect(200)

    expect(res.body.data.status).toBe('processing')
  })

  it('returns done status with result from Redis', async () => {
    const result = {
      hairType: 'wavy',
      conditionScore: 72,
      recommendations: ['rec_moisturize', 'rec_trim_regularly'],
      suggestedServices: ['svcHaircut'],
    }
    await redisClient.set(
      'hair-analysis:test-job-123',
      JSON.stringify({ status: 'done', result }),
      'EX', 3600,
    )

    const res = await request(app)
      .get('/api/v1/hair-analysis/test-job-123')
      .expect(200)

    expect(res.body.data.status).toBe('done')
    expect(res.body.data.result.hairType).toBe('wavy')
    expect(res.body.data.result.conditionScore).toBe(72)
  })
})

// ─── Worker: processHairAnalysisJob ──────────────────────────────────────────

describe('processHairAnalysisJob', () => {
  it('updates Redis to done and saves to DB', async () => {
    const { processHairAnalysisJob } = await import('@/jobs/hair-analysis.worker')

    // Ensure HairProfile exists for the FK
    await prisma.hairProfile.upsert({
      where:  { userId: custId },
      update: {},
      create: { userId: custId, dryness: 3, damage: 3, scalpCondition: 'normal', cutFrequencyWeeks: 4 },
    })

    await prisma.hairAnalysis.create({
      data: { userId: custId, jobId: 'test-job-123', imageKey: 'hair-analysis/test.jpg', status: 'processing' },
    })

    await processHairAnalysisJob('test-job-123', {
      userId: custId,
      imageKey: 'hair-analysis/test.jpg',
      mimeType: 'image/jpeg',
    })

    // Check Redis
    const raw = await redisClient.get('hair-analysis:test-job-123')
    const stored = JSON.parse(raw!)
    expect(stored.status).toBe('done')
    expect(stored.result.hairType).toBe('wavy')
    expect(stored.result.conditionScore).toBe(72)

    // Check DB record updated
    const record = await prisma.hairAnalysis.findUnique({ where: { jobId: 'test-job-123' } })
    expect(record?.status).toBe('done')
    expect(record?.hairType).toBe('wavy')

    // Check history created
    const history = await prisma.hairAnalysisHistory.findFirst({ where: { userId: custId } })
    expect(history?.hairType).toBe('wavy')
    expect(history?.conditionScore).toBe(72)
  })
})
