import { describe, it, expect } from 'vitest'
import request from 'supertest'
import express, { Request, Response, NextFunction } from 'express'
import { AppError } from '@/lib/errors'
import { errorHandler } from '@/middleware/error-handler'

function makeApp(thrower: (req: Request, res: Response, next: NextFunction) => void) {
  const app = express()
  app.use((_req, _res, next) => { _req.requestId = 'test-id'; next() })
  app.get('/test', thrower)
  app.use(errorHandler)
  return app
}

describe('errorHandler', () => {
  it('maps AppError to its status and code', async () => {
    const app = makeApp((_req, _res, next) => next(new AppError('not_found', 404)))
    const res = await request(app).get('/test')
    expect(res.status).toBe(404)
    expect(res.body.error).toBe('not_found')
  })

  it('returns English message by default', async () => {
    const app = makeApp((_req, _res, next) => next(new AppError('forbidden', 403)))
    const res = await request(app).get('/test')
    expect(res.body.message).toBe('Access denied')
  })

  it('returns Arabic message when lang=ar', async () => {
    const app = makeApp((_req, _res, next) => next(new AppError('forbidden', 403)))
    const res = await request(app).get('/test?lang=ar')
    expect(res.body.message).toBe('غير مصرح لك')
  })

  it('returns 400 for unknown errors with HTTP status', async () => {
    const app = makeApp((_req, _res, next) => {
      const err = Object.assign(new Error('too big'), { status: 413 })
      next(err)
    })
    const res = await request(app).get('/test')
    expect(res.status).toBe(413)
  })

  it('returns 500 for unknown errors', async () => {
    const app = makeApp((_req, _res, next) => next(new Error('something random')))
    const res = await request(app).get('/test')
    expect(res.status).toBe(500)
    expect(res.body.error).toBe('internal_error')
  })

  it('hides stack trace in production', async () => {
    process.env['NODE_ENV'] = 'production'
    const app = makeApp((_req, _res, next) => next(new Error('secret internal error')))
    const res = await request(app).get('/test')
    expect(res.body.stack).toBeUndefined()
    expect(res.body.detail).toBeUndefined()
    process.env['NODE_ENV'] = 'test'
  })
})
