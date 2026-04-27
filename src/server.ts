import { createApp } from '@/app'
import { prisma } from '@/config/prisma'
import { validateEnv } from '@/config/env'

const env = validateEnv()
const app = createApp(env)

const shutdown = async () => {
  await prisma.$disconnect()
  process.exit(0)
}

process.on('SIGTERM', shutdown)
process.on('SIGINT', shutdown)

const start = async () => {
  await prisma.$connect()
  app.listen(env.PORT, () => {
    console.log(`Server running on port ${env.PORT} [${env.NODE_ENV}]`)
  })
}

start().catch((err) => {
  console.error('Failed to start server:', err)
  process.exit(1)
})
