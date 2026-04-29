import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import request from 'supertest'
import { createApp } from '@/app'
import { prisma } from '@/config/prisma'
import { signAccess } from '@/lib/jwt'
import { cleanupPhone } from '../helpers/auth'

vi.mock('@/lib/sms', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/sms')>()
  return { ...actual, sendSms: vi.fn().mockResolvedValue(undefined) }
})

const app = createApp({ NODE_ENV: 'test', CORS_ORIGIN: 'http://localhost:3000' })

const E164_OWNER = '+9647900000104'
const E164_OTHER = '+9647900000105'

const BASE_SHOP = {
  nameEn: 'Schedule Shop', nameAr: 'محل',
  address: 'St', city: 'Baghdad',
  neighborhood: 'K', neighborhoodAr: 'ك',
  phone: '+9640000000104', lat: 33.34, lng: 44.40,
  status: 'APPROVED' as const, isActive: true,
}

const SCHEDULE = [
  { dayOfWeek: 0, startTime: '09:00', endTime: '17:00', isAvailable: true },
  { dayOfWeek: 1, startTime: '09:00', endTime: '17:00', isAvailable: true },
  { dayOfWeek: 2, startTime: '09:00', endTime: '17:00', isAvailable: true },
  { dayOfWeek: 3, startTime: '09:00', endTime: '17:00', isAvailable: true },
  { dayOfWeek: 4, startTime: '09:00', endTime: '17:00', isAvailable: true },
  { dayOfWeek: 5, startTime: '10:00', endTime: '14:00', isAvailable: true },
  { dayOfWeek: 6, startTime: '00:00', endTime: '00:00', isAvailable: false },
]

let ownerId: string
let ownerToken: string
let otherToken: string
let shopId: string
let barberId: string

beforeEach(async () => {
  const owner = await prisma.user.create({ data: { phone: E164_OWNER, name: 'Owner', role: 'SHOP_OWNER' } })
  ownerId = owner.id
  ownerToken = signAccess({ id: owner.id, role: owner.role })

  const other = await prisma.user.create({ data: { phone: E164_OTHER, name: 'Other', role: 'SHOP_OWNER' } })
  otherToken = signAccess({ id: other.id, role: other.role })

  const shop = await prisma.shop.create({ data: { ...BASE_SHOP, ownerId } })
  shopId = shop.id

  const barber = await prisma.barber.create({ data: { shopId, nameEn: 'Ali', nameAr: 'علي' } })
  barberId = barber.id
})

afterEach(async () => {
  await prisma.shop.deleteMany({ where: { ownerId } })
  await cleanupPhone(E164_OWNER)
  await cleanupPhone(E164_OTHER)
})

describe('PATCH /api/v1/shops/:shopId/barbers/:barberId/schedule', () => {
  it('sets schedule and returns 200', async () => {
    const res = await request(app)
      .patch(`/api/v1/shops/${shopId}/barbers/${barberId}/schedule`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .send(SCHEDULE)

    expect(res.status).toBe(200)
    const rows = await prisma.barberSchedule.findMany({ where: { barberId } })
    expect(rows.length).toBe(7)
  })

  it('replaces existing schedule on second call (no accumulation)', async () => {
    await request(app)
      .patch(`/api/v1/shops/${shopId}/barbers/${barberId}/schedule`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .send(SCHEDULE)

    await request(app)
      .patch(`/api/v1/shops/${shopId}/barbers/${barberId}/schedule`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .send(SCHEDULE)

    const rows = await prisma.barberSchedule.findMany({ where: { barberId } })
    expect(rows.length).toBe(7)
  })

  it('returns 403 for a different owner', async () => {
    const res = await request(app)
      .patch(`/api/v1/shops/${shopId}/barbers/${barberId}/schedule`)
      .set('Authorization', `Bearer ${otherToken}`)
      .send(SCHEDULE)

    expect(res.status).toBe(403)
  })

  it('returns 400 for invalid dayOfWeek', async () => {
    const res = await request(app)
      .patch(`/api/v1/shops/${shopId}/barbers/${barberId}/schedule`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .send([{ dayOfWeek: 9, startTime: '09:00', endTime: '17:00', isAvailable: true }])

    expect(res.status).toBe(400)
  })
})
