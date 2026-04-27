import { describe, it, expect, vi, beforeEach } from 'vitest'
import request from 'supertest'
import express, { Request, Response } from 'express'
import { signAccess } from '@/lib/jwt'
import { authenticate } from '@/middleware/auth'
import { requirePlan } from '@/middleware/require-plan'

vi.mock('@/config/prisma', () => ({
  prisma: {
    shop: {
      findUnique: vi.fn(),
    },
  },
}))

import { prisma } from '@/config/prisma'
const mockFindUnique = vi.mocked(prisma.shop.findUnique)

function makeApp(minPlan: 'FREE' | 'STARTER' | 'PRO') {
  const app = express()
  app.get(
    '/test',
    authenticate,
    requirePlan(minPlan),
    (_req: Request, res: Response) => res.json({ ok: true }),
  )
  return app
}

function bearer(plan?: string) {
  return `Bearer ${signAccess({ id: 'user-1', role: 'OWNER', shopId: 'shop-1' })}`
}

beforeEach(() => vi.clearAllMocks())

describe('requirePlan', () => {
  it('allows when shop plan meets the requirement', async () => {
    mockFindUnique.mockResolvedValue({ plan: 'STARTER' } as any)
    const res = await request(makeApp('STARTER'))
      .get('/test')
      .set('Authorization', bearer())
    expect(res.status).toBe(200)
  })

  it('allows when shop plan exceeds the requirement', async () => {
    mockFindUnique.mockResolvedValue({ plan: 'PRO' } as any)
    const res = await request(makeApp('STARTER'))
      .get('/test')
      .set('Authorization', bearer())
    expect(res.status).toBe(200)
  })

  it('returns 403 plan_required when plan is below requirement', async () => {
    mockFindUnique.mockResolvedValue({ plan: 'FREE' } as any)
    const res = await request(makeApp('STARTER'))
      .get('/test')
      .set('Authorization', bearer())
    expect(res.status).toBe(403)
    expect(res.body.error).toBe('plan_required')
    expect(res.body.requiredPlan).toBe('STARTER')
  })

  it('returns 403 when user has no shopId', async () => {
    const app = express()
    app.get(
      '/test',
      authenticate,
      requirePlan('STARTER'),
      (_req: Request, res: Response) => res.json({ ok: true }),
    )
    const token = `Bearer ${signAccess({ id: 'user-1', role: 'CUSTOMER' })}`
    const res = await request(app).get('/test').set('Authorization', token)
    expect(res.status).toBe(403)
  })

  it('returns 403 when shop is not found in DB', async () => {
    mockFindUnique.mockResolvedValue(null)
    const res = await request(makeApp('STARTER'))
      .get('/test')
      .set('Authorization', bearer())
    expect(res.status).toBe(403)
  })
})
