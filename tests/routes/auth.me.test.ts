import { describe, it, expect, afterEach, vi } from 'vitest'
import request from 'supertest'
import { createApp } from '@/app'
import { prisma } from '@/config/prisma'
import { signAccess } from '@/lib/jwt'
import { cleanupPhone } from '../helpers/auth'

vi.mock('@/lib/sms', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/sms')>()
  return { ...actual, sendSms: vi.fn().mockResolvedValue(undefined) }
})

const app = createApp({ NODE_ENV: 'test', CORS_ORIGIN: 'http://localhost:3000' })

const E164 = '+9647900000083'

afterEach(() => cleanupPhone(E164))

describe('GET /api/v1/auth/me', () => {
  it('returns the current user for a valid access token', async () => {
    const user = await prisma.user.create({
      data: { phone: E164, name: 'Ahmed', role: 'CUSTOMER' },
    })
    const accessToken = signAccess({ id: user.id, role: user.role })

    const res = await request(app)
      .get('/api/v1/auth/me')
      .set('Authorization', `Bearer ${accessToken}`)

    expect(res.status).toBe(200)
    expect(res.body.data.id).toBe(user.id)
    expect(res.body.data.phone).toBe(E164)
    expect(res.body.data.role).toBe('CUSTOMER')
    expect(res.body.data.isVip).toBe(false)
    expect(res.body.data.shopId).toBeUndefined()
  })

  it('returns 401 without a token', async () => {
    const res = await request(app).get('/api/v1/auth/me')
    expect(res.status).toBe(401)
  })

  it('returns 401 with a tampered token', async () => {
    const res = await request(app)
      .get('/api/v1/auth/me')
      .set('Authorization', 'Bearer not.a.real.token')
    expect(res.status).toBe(401)
  })
})
