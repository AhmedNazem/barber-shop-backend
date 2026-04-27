import { describe, it, expect } from 'vitest'
import request from 'supertest'
import express from 'express'
import { z } from 'zod'
import { validate } from '@/middleware/validate'

const schema = z.object({
  name: z.string().min(1),
  age:  z.coerce.number().int().min(0),
})

function makeApp(target: 'body' | 'query' | 'params' = 'body') {
  const app = express()
  app.use(express.json())
  if (target === 'body') {
    app.post('/test', validate(schema), (req, res) => res.json({ data: req.body }))
  } else if (target === 'query') {
    app.get('/test', validate(schema, 'query'), (req, res) => res.json({ data: req.query }))
  } else {
    app.get('/test/:name/:age', validate(schema, 'params'), (req, res) => res.json({ data: req.params }))
  }
  return app
}

describe('validate middleware', () => {
  it('passes valid body to the handler', async () => {
    const res = await request(makeApp()).post('/test').send({ name: 'Ahmed', age: 25 })
    expect(res.status).toBe(200)
    expect(res.body.data).toEqual({ name: 'Ahmed', age: 25 })
  })

  it('returns 400 for missing required field', async () => {
    const res = await request(makeApp()).post('/test').send({ age: 25 })
    expect(res.status).toBe(400)
    expect(res.body.error).toBe('validation_error')
    expect(res.body.errors.name).toBeDefined()
  })

  it('returns 400 for wrong type', async () => {
    const res = await request(makeApp()).post('/test').send({ name: 'Ahmed', age: 'not-a-number' })
    expect(res.status).toBe(400)
    expect(res.body.errors.age).toBeDefined()
  })

  it('coerces data — age arrives as number not string', async () => {
    const res = await request(makeApp()).post('/test').send({ name: 'Ahmed', age: '30' })
    expect(res.status).toBe(200)
    expect(typeof res.body.data.age).toBe('number')
  })

  it('validates query params when target is query', async () => {
    const res = await request(makeApp('query')).get('/test?name=Ahmed&age=25')
    expect(res.status).toBe(200)
    expect(res.body.data).toEqual({ name: 'Ahmed', age: 25 })
  })

  it('returns 400 for invalid query params', async () => {
    const res = await request(makeApp('query')).get('/test?age=25')
    expect(res.status).toBe(400)
    expect(res.body.errors.name).toBeDefined()
  })
})
