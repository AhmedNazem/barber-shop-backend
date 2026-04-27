import { describe, it, expect, afterAll } from 'vitest'
import { redisClient } from '@/lib/redis'

describe('redisClient', () => {
  afterAll(async () => {
    await redisClient.quit()
  })

  it('is a singleton — same reference on repeated imports', async () => {
    const { redisClient: second } = await import('@/lib/redis')
    expect(redisClient).toBe(second)
  })

  it('can connect and round-trip a value', async () => {
    await redisClient.connect()
    await redisClient.set('__test_ping__', 'pong', 'EX', 5)
    const val = await redisClient.get('__test_ping__')
    expect(val).toBe('pong')
    await redisClient.del('__test_ping__')
  })
})
