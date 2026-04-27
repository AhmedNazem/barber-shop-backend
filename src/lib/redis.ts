import Redis from 'ioredis'

const globalForRedis = globalThis as unknown as { redis?: Redis }

function createClient(): Redis {
  const url = process.env['REDIS_URL']
  if (!url) throw new Error('REDIS_URL is not set')

  const client = new Redis(url, {
    maxRetriesPerRequest: null,
    enableReadyCheck: false,
    lazyConnect: true,
  })

  client.on('error', (err) => {
    // Avoid crashing the process on transient connection errors
    console.error('[redis] connection error:', err.message)
  })

  return client
}

export const redisClient: Redis =
  globalForRedis.redis ?? createClient()

if (process.env['NODE_ENV'] !== 'production') {
  globalForRedis.redis = redisClient
}
