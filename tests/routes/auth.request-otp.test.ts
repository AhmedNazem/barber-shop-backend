import { describe, it, expect, afterEach, vi } from 'vitest'
import request from 'supertest'
import { createApp } from '@/app'
import { prisma } from '@/config/prisma'
import { cleanupPhone } from '../helpers/auth'

vi.mock('@/lib/sms', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/sms')>()
  return { ...actual, sendSms: vi.fn().mockResolvedValue(undefined) }
})

const app = createApp({ NODE_ENV: 'test', CORS_ORIGIN: 'http://localhost:3000' })

const TEST_PHONE = '07900000081'
const E164 = '+9647900000081'

afterEach(() => cleanupPhone(E164))

describe('POST /api/v1/auth/request-otp', () => {
  it('returns 200 { data: { ok: true } } for a valid Iraqi phone', async () => {
    const res = await request(app)
      .post('/api/v1/auth/request-otp')
      .send({ phone: TEST_PHONE })

    expect(res.status).toBe(200)
    expect(res.body.data.ok).toBe(true)
  })

  it('creates an OtpCode record in the DB', async () => {
    await request(app)
      .post('/api/v1/auth/request-otp')
      .send({ phone: TEST_PHONE })

    const record = await prisma.otpCode.findFirst({ where: { phone: E164 } })
    expect(record).not.toBeNull()
  })

  it('returns 400 for an invalid phone number', async () => {
    const res = await request(app)
      .post('/api/v1/auth/request-otp')
      .send({ phone: '12345' })

    expect(res.status).toBe(400)
  })

  it('returns 400 when phone is missing', async () => {
    const res = await request(app)
      .post('/api/v1/auth/request-otp')
      .send({})

    expect(res.status).toBe(400)
  })
})
