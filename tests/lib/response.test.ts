import { describe, it, expect } from 'vitest'
import request from 'supertest'
import express, { Request, Response } from 'express'
import { ok, paginated } from '@/lib/response'

describe('ok', () => {
  it('wraps data in { data } with 200 by default', async () => {
    const app = express()
    app.get('/test', (_req: Request, res: Response) => ok(res, { name: 'Ahmed' }))
    const res = await request(app).get('/test')
    expect(res.status).toBe(200)
    expect(res.body).toEqual({ data: { name: 'Ahmed' } })
  })

  it('uses the provided status code', async () => {
    const app = express()
    app.post('/test', (_req: Request, res: Response) => ok(res, { id: '1' }, 201))
    const res = await request(app).post('/test')
    expect(res.status).toBe(201)
    expect(res.body).toEqual({ data: { id: '1' } })
  })

  it('works with an array', async () => {
    const app = express()
    app.get('/test', (_req: Request, res: Response) => ok(res, [1, 2, 3]))
    const res = await request(app).get('/test')
    expect(res.body).toEqual({ data: [1, 2, 3] })
  })
})

describe('paginated', () => {
  it('wraps data with meta in { data, meta }', async () => {
    const app = express()
    app.get('/test', (_req: Request, res: Response) =>
      paginated(res, [{ id: 'a' }], { total: 50, limit: 20, offset: 0 }),
    )
    const res = await request(app).get('/test')
    expect(res.status).toBe(200)
    expect(res.body).toEqual({
      data: [{ id: 'a' }],
      meta: { total: 50, limit: 20, offset: 0 },
    })
  })

  it('returns empty array when no results', async () => {
    const app = express()
    app.get('/test', (_req: Request, res: Response) =>
      paginated(res, [], { total: 0, limit: 20, offset: 0 }),
    )
    const res = await request(app).get('/test')
    expect(res.body.data).toEqual([])
    expect(res.body.meta.total).toBe(0)
  })
})
