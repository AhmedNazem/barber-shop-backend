import { createApp } from '@/app'
import { prisma } from '@/config/prisma'
import { validateEnv } from '@/config/env'
import { redisClient } from '@/lib/redis'

const env = validateEnv()
const app = createApp(env)

let httpServer: ReturnType<typeof app.listen> | undefined

const shutdown = async () => {
  await new Promise<void>((resolve) => {
    if (httpServer) httpServer.close(() => resolve())
    else resolve()
  })
  await Promise.allSettled([
    prisma.$disconnect(),
    redisClient.quit(),
  ])
  process.exit(0)
}

process.on('SIGTERM', shutdown)
process.on('SIGINT', shutdown)

const start = async () => {
  // Prisma connects lazily on first query — no explicit connect needed.
  // This avoids startup failures when Neon wakes from sleep.
  httpServer = app.listen(env.PORT, () => {
    console.log(`Server running on port ${env.PORT} [${env.NODE_ENV}]`)
  })
}

start().catch((err) => {
  console.error('Failed to start server:', err)
  process.exit(1)
})
