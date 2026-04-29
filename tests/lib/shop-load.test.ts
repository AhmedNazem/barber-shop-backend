import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { prisma } from '@/config/prisma'
import { redisClient } from '@/lib/redis'
import { computeLoad } from '@/lib/shop-load'

const E164_OWNER = '+9647900000097'

const BASE_SHOP = {
  nameEn: 'Load Shop', nameAr: 'محل',
  address: 'St', city: 'Baghdad',
  neighborhood: 'K', neighborhoodAr: 'ك',
  phone: '+9640000000097', lat: 33.34, lng: 44.40,
  status: 'APPROVED' as const, isActive: true,
}

let ownerId: string
let shopId: string

beforeEach(async () => {
  const owner = await prisma.user.create({ data: { phone: E164_OWNER, name: 'Owner', role: 'SHOP_OWNER' } })
  ownerId = owner.id
  const shop = await prisma.shop.create({ data: { ...BASE_SHOP, ownerId } })
  shopId = shop.id
  await redisClient.del(`shop:load:${shopId}`)
})

afterEach(async () => {
  await redisClient.del(`shop:load:${shopId}`)
  await prisma.shop.deleteMany({ where: { ownerId } })
  await prisma.user.deleteMany({ where: { phone: E164_OWNER } })
})

describe('computeLoad', () => {
  it('returns low when there are no barbers', async () => {
    expect(await computeLoad(shopId)).toBe('low')
  })

  it('returns low when queue is less than half the barber count', async () => {
    await prisma.barber.createMany({ data: [
      { shopId, nameEn: 'A', nameAr: 'أ' },
      { shopId, nameEn: 'B', nameAr: 'ب' },
    ]})
    expect(await computeLoad(shopId)).toBe('low')
  })

  it('returns medium when queue equals barber count', async () => {
    const barber = await prisma.barber.create({ data: { shopId, nameEn: 'A', nameAr: 'أ' } })
    await prisma.queueEntry.create({
      data: { shopId, barberId: barber.id, customerName: 'Test', serviceIds: [], status: 'WAITING', position: 1 },
    })
    expect(await computeLoad(shopId)).toBe('medium')
  })

  it('returns high when queue is more than 1.5x barber count', async () => {
    const barber = await prisma.barber.create({ data: { shopId, nameEn: 'A', nameAr: 'أ' } })
    await prisma.queueEntry.createMany({ data: [
      { shopId, barberId: barber.id, customerName: 'Test', serviceIds: [], status: 'WAITING', position: 1 },
      { shopId, barberId: barber.id, customerName: 'Test', serviceIds: [], status: 'IN_CHAIR', position: 2 },
    ]})
    expect(await computeLoad(shopId)).toBe('high')
  })

  it('caches the result in Redis for 60 seconds', async () => {
    await computeLoad(shopId)
    const cached = await redisClient.get(`shop:load:${shopId}`)
    expect(cached).toBe('low')
    const ttl = await redisClient.ttl(`shop:load:${shopId}`)
    expect(ttl).toBeGreaterThan(0)
    expect(ttl).toBeLessThanOrEqual(60)
  })
})
