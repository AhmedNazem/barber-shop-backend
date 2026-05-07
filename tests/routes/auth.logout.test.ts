import { describe, it, expect, afterEach, vi } from 'vitest'
import request from 'supertest'
import { createApp } from '@/app'
import { prisma } from '@/config/prisma'
import { signAccess, signRefresh } from '@/lib/jwt'
import { cleanupPhone } from '../helpers/auth'

vi.mock('@/lib/sms', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/sms')>()
  return { ...actual, sendSms: vi.fn().mockResolvedValue(undefined) }
})

const app = createApp({ NODE_ENV: 'test', CORS_ORIGIN: 'http://localhost:3000' })

const E164 = '+9647900000085'

afterEach(() => cleanupPhone(E164))

async function seedUserAndTokens() {
  const user = await prisma.user.create({
    data: { phone: E164, name: 'Ahmed', role: 'CUSTOMER' },
  })
  const accessToken = signAccess({ id: user.id, role: user.role })
  const refreshToken = signRefresh({ id: user.id, role: user.role })
  await prisma.refreshToken.create({
    data: { userId: user.id, token: refreshToken, expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000) },
  })
  return { user, accessToken, refreshToken }
}

describe('POST /api/v1/auth/logout', () => {
  it('returns 200 and deletes the refresh token from DB', async () => {
    const { accessToken, refreshToken } = await seedUserAndTokens()

    const res = await request(app)
      .post('/api/v1/auth/logout')
      .set('Authorization', `Bearer ${accessToken}`)
      .set('Cookie', [`refreshToken=${refreshToken}`])

    expect(res.status).toBe(200)
    expect(res.body.data.ok).toBe(true)

    const stored = await prisma.refreshToken.findUnique({ where: { token: refreshToken } })
    expect(stored).toBeNull()
  })

  it('returns 401 without an access token', async () => {
    const res = await request(app).post('/api/v1/auth/logout').send({})
    expect(res.status).toBe(401)
  })

  it('still returns 200 when no refresh token is provided (cookie/body empty)', async () => {
    const { accessToken } = await seedUserAndTokens()

    const res = await request(app)
      .post('/api/v1/auth/logout')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({})

    expect(res.status).toBe(200)
  })
})
