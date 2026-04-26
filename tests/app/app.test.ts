import { describe, it, expect } from 'vitest'
import request from 'supertest'
import { createApp } from '@/app'

const config = {
  NODE_ENV: 'test' as const,
  CORS_ORIGIN: 'http://localhost:3000',
}

const app = createApp(config)

describe('createApp', () => {
  it('returns X-Request-Id header on every response', async () => {
    const res = await request(app).get('/api/v1/nonexistent')
    expect(res.headers['x-request-id']).toBeDefined()
  })

  it('uses provided X-Request-Id if sent by client', async () => {
    const res = await request(app)
      .get('/api/v1/nonexistent')
      .set('X-Request-Id', 'my-custom-id')
    expect(res.headers['x-request-id']).toBe('my-custom-id')
  })

  it('sets helmet security headers', async () => {
    const res = await request(app).get('/api/v1/nonexistent')
    expect(res.headers['x-frame-options']).toBeDefined()
    expect(res.headers['x-content-type-options']).toBeDefined()
  })

  it('allows requests from CORS_ORIGIN', async () => {
    const res = await request(app)
      .get('/api/v1/nonexistent')
      .set('Origin', 'http://localhost:3000')
    expect(res.headers['access-control-allow-origin']).toBe('http://localhost:3000')
  })

  it('rejects oversized JSON body', async () => {
    const big = { data: 'x'.repeat(11 * 1024) }
    const res = await request(app).post('/api/v1/nonexistent').send(big)
    expect(res.status).toBe(413)
  })
})
