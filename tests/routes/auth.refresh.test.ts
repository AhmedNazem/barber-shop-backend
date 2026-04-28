import { describe, it, expect, afterEach, vi } from 'vitest'
import request from 'supertest'
import { createApp } from '@/app'
import { prisma } from '@/config/prisma'
import { signRefresh } from '@/lib/jwt'
import { cleanupPhone } from '../helpers/auth'

vi.mock('@/lib/sms', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/sms')>()
  return { ...actual, sendSms: vi.fn().mockResolvedValue(undefined) }
})

const app = createApp({ NODE_ENV: 'test', CORS_ORIGIN: 'http://localhost:3000' })

const E164 = '+9647900000084'

afterEach(() => cleanupPhone(E164))

async function seedUserAndToken() {
  const user = await prisma.user.create({
    data: { phone: E164, name: 'Ahmed', role: 'CUSTOMER' },
  })
  const refreshToken = signRefresh({ id: user.id, role: user.role })
  await prisma.refreshToken.create({
    data: { userId: user.id, token: refreshToken, expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000) },
  })
  return { user, refreshToken }
}

describe('POST /api/v1/auth/refresh', () => {
  it('returns a new accessToken when given a valid refresh token in the body', async () => {
    const { refreshToken } = await seedUserAndToken()

    const res = await request(app)
      .post('/api/v1/auth/refresh')
      .send({ refreshToken })

    expect(res.status).toBe(200)
    expect(res.body.data.accessToken).toBeTruthy()
  })

  it('returns 401 when no token is provided', async () => {
    const res = await request(app).post('/api/v1/auth/refresh').send({})
    expect(res.status).toBe(401)
  })

  it('returns 401 for a token not in the DB (already revoked)', async () => {
    const user = await prisma.user.create({
      data: { phone: E164, name: 'Ahmed', role: 'CUSTOMER' },
    })
    const rogueToken = signRefresh({ id: user.id, role: 'CUSTOMER' })

    const res = await request(app)
      .post('/api/v1/auth/refresh')
      .send({ refreshToken: rogueToken })

    expect(res.status).toBe(401)
  })

  it('returns 401 for a tampered/invalid JWT', async () => {
    const res = await request(app)
      .post('/api/v1/auth/refresh')
      .send({ refreshToken: 'not.a.valid.token' })

    expect(res.status).toBe(401)
  })
})
