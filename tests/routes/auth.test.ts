import { describe, it, expect, afterEach, vi } from 'vitest'
import request from 'supertest'
import bcrypt from 'bcrypt'
import { createApp } from '@/app'
import { prisma } from '@/config/prisma'

vi.mock('@/lib/sms', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/sms')>()
  return { ...actual, sendSms: vi.fn().mockResolvedValue(undefined) }
})

const app = createApp({ NODE_ENV: 'test', CORS_ORIGIN: 'http://localhost:3000' })

const TEST_PHONE = '07900000088'
const E164 = '+9647900000088'

async function seedOtp(opts: { expired?: boolean; locked?: boolean; attempts?: number } = {}) {
  const plainCode = '123456'
  const hashed = await bcrypt.hash(plainCode, 10)
  await prisma.otpCode.create({
    data: {
      phone: E164,
      code: hashed,
      expiresAt: opts.expired
        ? new Date(Date.now() - 1000)
        : new Date(Date.now() + 5 * 60 * 1000),
      locked: opts.locked ?? false,
      attempts: opts.attempts ?? 0,
    },
  })
  return plainCode
}

afterEach(async () => {
  await prisma.refreshToken.deleteMany({ where: { user: { phone: E164 } } })
  await prisma.user.deleteMany({ where: { phone: E164 } })
  await prisma.otpCode.deleteMany({ where: { phone: E164 } })
})

// ─── POST /auth/request-otp ───────────────────────────────────────────────────

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

// ─── POST /auth/verify-otp ────────────────────────────────────────────────────

describe('POST /api/v1/auth/verify-otp', () => {
  it('registers a new customer and returns tokens', async () => {
    const code = await seedOtp()

    const res = await request(app)
      .post('/api/v1/auth/verify-otp')
      .send({ phone: TEST_PHONE, otp: code, name: 'Ahmed', isRegister: true })

    expect(res.status).toBe(200)
    expect(res.body.data.accessToken).toBeTruthy()
    expect(res.body.data.refreshToken).toBeTruthy()
    expect(res.body.data.role).toBe('CUSTOMER')
  })

  it('registers a shop owner when shopName is provided', async () => {
    const code = await seedOtp()

    const res = await request(app)
      .post('/api/v1/auth/verify-otp')
      .send({ phone: TEST_PHONE, otp: code, name: 'Ahmed', shopName: 'My Shop', isRegister: true })

    expect(res.status).toBe(200)
    expect(res.body.data.role).toBe('SHOP_OWNER')
  })

  it('logs in an existing user without isRegister', async () => {
    // Create user first
    await prisma.user.create({ data: { phone: E164, name: 'Ahmed', role: 'CUSTOMER' } })
    const code = await seedOtp()

    const res = await request(app)
      .post('/api/v1/auth/verify-otp')
      .send({ phone: TEST_PHONE, otp: code })

    expect(res.status).toBe(200)
    expect(res.body.data.accessToken).toBeTruthy()
  })

  it('returns 401 for a wrong OTP code', async () => {
    await seedOtp()

    const res = await request(app)
      .post('/api/v1/auth/verify-otp')
      .send({ phone: TEST_PHONE, otp: '000000' })

    expect(res.status).toBe(401)
    expect(res.body.error).toBe('invalid_otp')
  })

  it('returns 410 for an expired OTP', async () => {
    await seedOtp({ expired: true })

    const res = await request(app)
      .post('/api/v1/auth/verify-otp')
      .send({ phone: TEST_PHONE, otp: '123456' })

    expect(res.status).toBe(410)
    expect(res.body.error).toBe('otp_expired')
  })

  it('returns 429 for a locked OTP', async () => {
    await seedOtp({ locked: true })

    const res = await request(app)
      .post('/api/v1/auth/verify-otp')
      .send({ phone: TEST_PHONE, otp: '123456' })

    expect(res.status).toBe(429)
    expect(res.body.error).toBe('otp_locked')
  })

  it('returns 400 when registering without a name', async () => {
    const code = await seedOtp()

    const res = await request(app)
      .post('/api/v1/auth/verify-otp')
      .send({ phone: TEST_PHONE, otp: code, isRegister: true })

    expect(res.status).toBe(400)
    expect(res.body.error).toBe('name_required')
  })

  it('returns 404 when logging in with a phone that has no account', async () => {
    const code = await seedOtp()

    const res = await request(app)
      .post('/api/v1/auth/verify-otp')
      .send({ phone: TEST_PHONE, otp: code, isRegister: false })

    expect(res.status).toBe(404)
    expect(res.body.error).toBe('user_not_found')
  })

  it('sets an httpOnly refreshToken cookie', async () => {
    const code = await seedOtp()

    const res = await request(app)
      .post('/api/v1/auth/verify-otp')
      .send({ phone: TEST_PHONE, otp: code, name: 'Ahmed', isRegister: true })

    const cookies = res.headers['set-cookie'] as string[] | string
    const cookieStr = Array.isArray(cookies) ? cookies.join(';') : cookies
    expect(cookieStr).toContain('refreshToken')
    expect(cookieStr).toContain('HttpOnly')
  })
})
