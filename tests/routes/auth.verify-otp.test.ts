import { describe, it, expect, afterEach, vi } from 'vitest'
import request from 'supertest'
import { createApp } from '@/app'
import { prisma } from '@/config/prisma'
import { seedOtp, cleanupPhone } from '../helpers/auth'

vi.mock('@/lib/sms', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/sms')>()
  return { ...actual, sendSms: vi.fn().mockResolvedValue(undefined) }
})

const app = createApp({ NODE_ENV: 'test', CORS_ORIGIN: 'http://localhost:3000' })

const TEST_PHONE = '07900000082'
const E164 = '+9647900000082'

afterEach(() => cleanupPhone(E164))

describe('POST /api/v1/auth/verify-otp', () => {
  it('registers a new customer and returns tokens', async () => {
    const code = await seedOtp(E164)

    const res = await request(app)
      .post('/api/v1/auth/verify-otp')
      .send({ phone: TEST_PHONE, otp: code, name: 'Ahmed', isRegister: true })

    expect(res.status).toBe(200)
    expect(res.body.data.accessToken).toBeTruthy()
    expect(res.body.data.role).toBe('CUSTOMER')
    expect(res.headers['set-cookie']).toBeDefined()
  })

  it('registers a shop owner when shopName is provided', async () => {
    const code = await seedOtp(E164)

    const res = await request(app)
      .post('/api/v1/auth/verify-otp')
      .send({ phone: TEST_PHONE, otp: code, name: 'Ahmed', shopName: 'My Shop', isRegister: true })

    expect(res.status).toBe(200)
    expect(res.body.data.role).toBe('SHOP_OWNER')
  })

  it('logs in an existing user without isRegister', async () => {
    await prisma.user.create({ data: { phone: E164, name: 'Ahmed', role: 'CUSTOMER' } })
    const code = await seedOtp(E164)

    const res = await request(app)
      .post('/api/v1/auth/verify-otp')
      .send({ phone: TEST_PHONE, otp: code })

    expect(res.status).toBe(200)
    expect(res.body.data.accessToken).toBeTruthy()
  })

  it('returns 401 for a wrong OTP code', async () => {
    await seedOtp(E164)

    const res = await request(app)
      .post('/api/v1/auth/verify-otp')
      .send({ phone: TEST_PHONE, otp: '000000' })

    expect(res.status).toBe(401)
    expect(res.body.error).toBe('invalid_otp')
  })

  it('returns 410 for an expired OTP', async () => {
    await seedOtp(E164, { expired: true })

    const res = await request(app)
      .post('/api/v1/auth/verify-otp')
      .send({ phone: TEST_PHONE, otp: '123456' })

    expect(res.status).toBe(410)
    expect(res.body.error).toBe('otp_expired')
  })

  it('returns 429 with retryAfter for a locked OTP', async () => {
    await seedOtp(E164, { locked: true })

    const res = await request(app)
      .post('/api/v1/auth/verify-otp')
      .send({ phone: TEST_PHONE, otp: '123456' })

    expect(res.status).toBe(429)
    expect(res.body.error).toBe('otp_locked')
    expect(typeof res.body.retryAfter).toBe('number')
    expect(res.body.retryAfter).toBeGreaterThan(0)
  })

  it('returns 400 when registering without a name', async () => {
    const code = await seedOtp(E164)

    const res = await request(app)
      .post('/api/v1/auth/verify-otp')
      .send({ phone: TEST_PHONE, otp: code, isRegister: true })

    expect(res.status).toBe(400)
    expect(res.body.error).toBe('name_required')
  })

  it('returns 404 when logging in with a phone that has no account', async () => {
    const code = await seedOtp(E164)

    const res = await request(app)
      .post('/api/v1/auth/verify-otp')
      .send({ phone: TEST_PHONE, otp: code, isRegister: false })

    expect(res.status).toBe(404)
    expect(res.body.error).toBe('user_not_found')
  })

  it('sets an httpOnly refreshToken cookie', async () => {
    const code = await seedOtp(E164)

    const res = await request(app)
      .post('/api/v1/auth/verify-otp')
      .send({ phone: TEST_PHONE, otp: code, name: 'Ahmed', isRegister: true })

    const cookies = res.headers['set-cookie'] as string[] | string
    const cookieStr = Array.isArray(cookies) ? cookies.join(';') : cookies
    expect(cookieStr).toContain('refreshToken')
    expect(cookieStr).toContain('HttpOnly')
  })
})
