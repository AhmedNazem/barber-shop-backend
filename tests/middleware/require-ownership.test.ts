import { describe, it, expect } from 'vitest'
import request from 'supertest'
import express, { Request, Response } from 'express'
import { authenticate } from '@/middleware/auth'
import { requireOwnership } from '@/middleware/require-ownership'
import { signAccess } from '@/lib/jwt'

const fromParam = (req: Request) => req.params['shopId']

function makeApp() {
  const app = express()
  app.get(
    '/shops/:shopId/settings',
    authenticate,
    requireOwnership(fromParam),
    (_req: Request, res: Response) => res.json({ ok: true }),
  )
  return app
}

function bearer(role: string, shopId?: string) {
  return `Bearer ${signAccess({ id: 'user-1', role, shopId })}`
}

describe('requireOwnership', () => {
  it('allows the owner of the shop', async () => {
    const res = await request(makeApp())
      .get('/shops/shop-1/settings')
      .set('Authorization', bearer('OWNER', 'shop-1'))
    expect(res.status).toBe(200)
  })

  it('returns 403 when user owns a different shop', async () => {
    const res = await request(makeApp())
      .get('/shops/shop-1/settings')
      .set('Authorization', bearer('OWNER', 'shop-2'))
    expect(res.status).toBe(403)
    expect(res.body.error).toBe('forbidden')
  })

  it('returns 403 when user has no shopId', async () => {
    const res = await request(makeApp())
      .get('/shops/shop-1/settings')
      .set('Authorization', bearer('CUSTOMER'))
    expect(res.status).toBe(403)
  })

  it('allows ADMIN regardless of shopId', async () => {
    const res = await request(makeApp())
      .get('/shops/shop-1/settings')
      .set('Authorization', bearer('ADMIN'))
    expect(res.status).toBe(200)
  })

  it('returns 401 when no token is provided', async () => {
    const res = await request(makeApp()).get('/shops/shop-1/settings')
    expect(res.status).toBe(401)
  })
})
