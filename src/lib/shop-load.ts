import { prisma } from '@/config/prisma'
import { redisClient } from '@/lib/redis'

const LOAD_TTL = 60

export async function computeLoad(shopId: string): Promise<'low' | 'medium' | 'high'> {
  const cacheKey = `shop:load:${shopId}`
  const cached = await redisClient.get(cacheKey)
  if (cached) return cached as 'low' | 'medium' | 'high'

  const [queueCount, barberCount] = await Promise.all([
    prisma.queueEntry.count({ where: { shopId, status: { in: ['WAITING', 'IN_CHAIR'] } } }),
    prisma.barber.count({ where: { shopId, isActive: true } }),
  ])

  const ratio = barberCount > 0 ? queueCount / barberCount : 0
  const load: 'low' | 'medium' | 'high' = ratio < 0.5 ? 'low' : ratio < 1.5 ? 'medium' : 'high'

  await redisClient.setex(cacheKey, LOAD_TTL, load)
  return load
}
