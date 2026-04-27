import { describe, it, expect, vi, beforeEach } from 'vitest'
import request from 'supertest'
import express, { Request, Response } from 'express'
import { authenticate } from '@/middleware/auth'
import { requireShopStatus } from '@/middleware/require-shop-status'
import { signAccess } from '@/lib/jwt'

vi.mock('@/config/prisma', () => ({
  prisma: {
    shop: {
      findUnique: vi.fn(),
    },
  },
}))

import { prisma } from '@/config/prisma'
const mockFindUnique = vi.mocked(prisma.shop.findUnique)

function makeApp() {
  const app = express()
  app.get(
    '/dashboard',
    authenticate,
    requireShopStatus(),
    (_req: Request, res: Response) => res.json({ ok: true }),
  )
  return app
}

const ownerToken = `Bearer ${signAccess({ id: 'u1', role: 'OWNER', shopId: 'shop-1' })}`

beforeEach(() => vi.clearAllMocks())

describe('requireShopStatus', () => {
  it('allows access when shop is APPROVED', async () => {
    mockFindUnique.mockResolvedValue({ status: 'APPROVED' } as any)
    const res = await request(makeApp()).get('/dashboard').set('Authorization', ownerToken)
    expect(res.status).toBe(200)
  })

  it('returns 403 shop_pending when shop is PENDING', async () => {
    mockFindUnique.mockResolvedValue({ status: 'PENDING' } as any)
    const res = await request(makeApp()).get('/dashboard').set('Authorization', ownerToken)
    expect(res.status).toBe(403)
    expect(res.body.error).toBe('shop_pending')
  })

  it('returns 403 shop_rejected when shop is REJECTED', async () => {
    mockFindUnique.mockResolvedValue({ status: 'REJECTED' } as any)
    const res = await request(makeApp()).get('/dashboard').set('Authorization', ownerToken)
    expect(res.status).toBe(403)
    expect(res.body.error).toBe('shop_rejected')
  })

  it('returns 403 shop_suspended when shop is SUSPENDED', async () => {
    mockFindUnique.mockResolvedValue({ status: 'SUSPENDED' } as any)
    const res = await request(makeApp()).get('/dashboard').set('Authorization', ownerToken)
    expect(res.status).toBe(403)
    expect(res.body.error).toBe('shop_suspended')
  })

  it('returns 403 when user has no shopId', async () => {
    const token = `Bearer ${signAccess({ id: 'u1', role: 'CUSTOMER' })}`
    const res = await request(makeApp()).get('/dashboard').set('Authorization', token)
    expect(res.status).toBe(403)
  })

  it('returns 403 when shop is not found', async () => {
    mockFindUnique.mockResolvedValue(null)
    const res = await request(makeApp()).get('/dashboard').set('Authorization', ownerToken)
    expect(res.status).toBe(403)
  })
})
