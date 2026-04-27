import { describe, it, expect } from 'vitest'
import request from 'supertest'
import { createApp } from '@/app'

const app = createApp({ NODE_ENV: 'test', CORS_ORIGIN: 'http://localhost:3000' })

describe('GET /health', () => {
  it('returns 200 with ok: true', async () => {
    const res = await request(app).get('/health')
    expect(res.status).toBe(200)
    expect(res.body.ok).toBe(true)
  })

  it('returns the current NODE_ENV', async () => {
    const res = await request(app).get('/health')
    expect(res.body.env).toBe('test')
  })

  it('returns a version string', async () => {
    const res = await request(app).get('/health')
    expect(typeof res.body.version).toBe('string')
    expect(res.body.version.length).toBeGreaterThan(0)
  })

  it('requires no authentication', async () => {
    const res = await request(app).get('/health')
    expect(res.status).not.toBe(401)
    expect(res.status).not.toBe(403)
  })
})
