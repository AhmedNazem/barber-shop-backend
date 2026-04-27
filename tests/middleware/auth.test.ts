import { describe, it, expect } from 'vitest'
import request from 'supertest'
import express, { Request, Response } from 'express'
import { authenticate } from '@/middleware/auth'
import { signAccess } from '@/lib/jwt'
import jwt from 'jsonwebtoken'

function makeApp() {
  const app = express()
  app.get('/test', authenticate, (req: Request, res: Response) => {
    res.json({ user: req.user })
  })
  return app
}

const validPayload = { id: 'user-1', role: 'CUSTOMER' }

describe('authenticate middleware', () => {
  it('sets req.user and calls next for a valid token', async () => {
    const token = signAccess(validPayload)
    const res = await request(makeApp())
      .get('/test')
      .set('Authorization', `Bearer ${token}`)
    expect(res.status).toBe(200)
    expect(res.body.user.id).toBe('user-1')
    expect(res.body.user.role).toBe('CUSTOMER')
  })

  it('returns 401 when Authorization header is missing', async () => {
    const res = await request(makeApp()).get('/test')
    expect(res.status).toBe(401)
    expect(res.body.error).toBe('unauthorized')
  })

  it('returns 401 when token is malformed', async () => {
    const res = await request(makeApp())
      .get('/test')
      .set('Authorization', 'Bearer not-a-real-token')
    expect(res.status).toBe(401)
    expect(res.body.error).toBe('unauthorized')
  })

  it('returns 401 when scheme is not Bearer', async () => {
    const token = signAccess(validPayload)
    const res = await request(makeApp())
      .get('/test')
      .set('Authorization', `Basic ${token}`)
    expect(res.status).toBe(401)
  })

  it('returns 403 when token is expired', async () => {
    const secret = process.env['JWT_SECRET']!
    const expired = jwt.sign(validPayload, secret, { expiresIn: -1 })
    const res = await request(makeApp())
      .get('/test')
      .set('Authorization', `Bearer ${expired}`)
    expect(res.status).toBe(403)
    expect(res.body.error).toBe('token_expired')
  })
})
