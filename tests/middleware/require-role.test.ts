import { describe, it, expect } from 'vitest'
import request from 'supertest'
import express, { Request, Response } from 'express'
import { requireRole } from '@/middleware/require-role'
import { signAccess } from '@/lib/jwt'
import { authenticate } from '@/middleware/auth'

function makeApp(...roles: string[]) {
  const app = express()
  app.get('/test', authenticate, requireRole(...roles), (_req: Request, res: Response) => {
    res.json({ ok: true })
  })
  return app
}

function bearer(role: string) {
  return `Bearer ${signAccess({ id: 'user-1', role })}`
}

describe('requireRole', () => {
  it('allows a user whose role is in the list', async () => {
    const res = await request(makeApp('OWNER'))
      .get('/test')
      .set('Authorization', bearer('OWNER'))
    expect(res.status).toBe(200)
    expect(res.body.ok).toBe(true)
  })

  it('allows when multiple roles are accepted', async () => {
    const res = await request(makeApp('OWNER', 'BARBER'))
      .get('/test')
      .set('Authorization', bearer('BARBER'))
    expect(res.status).toBe(200)
  })

  it('returns 403 when role is not in the list', async () => {
    const res = await request(makeApp('OWNER'))
      .get('/test')
      .set('Authorization', bearer('CUSTOMER'))
    expect(res.status).toBe(403)
    expect(res.body.error).toBe('forbidden')
  })

  it('returns 401 when no token is provided', async () => {
    const res = await request(makeApp('OWNER')).get('/test')
    expect(res.status).toBe(401)
  })
})
