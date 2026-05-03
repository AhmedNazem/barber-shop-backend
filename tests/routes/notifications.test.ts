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

const E164_USER_A = '+9647900000126'
const E164_USER_B = '+9647900000127'

let userAId:    string
let userBId:    string
let tokenA:     string
let tokenB:     string

beforeEach(async () => {
  await cleanupPhone(E164_USER_A)
  await cleanupPhone(E164_USER_B)

  const userA = await prisma.user.create({ data: { phone: E164_USER_A, name: 'UserA', role: 'CUSTOMER' } })
  const userB = await prisma.user.create({ data: { phone: E164_USER_B, name: 'UserB', role: 'CUSTOMER' } })
  userAId = userA.id
  userBId = userB.id
  tokenA  = signAccess({ id: userAId, role: 'CUSTOMER', shopId: undefined })
  tokenB  = signAccess({ id: userBId, role: 'CUSTOMER', shopId: undefined })
})

afterEach(async () => {
  await prisma.notification.deleteMany({ where: { userId: { in: [userAId, userBId] } } })
  await cleanupPhone(E164_USER_A)
  await cleanupPhone(E164_USER_B)
})

async function seedNotification(userId: string, isRead = false) {
  return prisma.notification.create({
    data: {
      userId, type: 'SYSTEM_ALERT',
      title: 'Test', titleAr: 'اختبار',
      message: 'Hello', messageAr: 'مرحبا',
      isRead,
    },
  })
}

// ── GET /notifications ────────────────────────────────────────────────────────

describe('GET /api/v1/notifications', () => {
  it('returns empty list and unreadCount 0 for new user', async () => {
    const res = await request(app)
      .get('/api/v1/notifications')
      .set('Authorization', `Bearer ${tokenA}`)

    expect(res.status).toBe(200)
    expect(res.body.data.notifications).toEqual([])
    expect(res.body.data.unreadCount).toBe(0)
  })

  it('returns notifications with correct unreadCount', async () => {
    await seedNotification(userAId, false) // unread
    await seedNotification(userAId, false) // unread
    await seedNotification(userAId, true)  // read

    const res = await request(app)
      .get('/api/v1/notifications')
      .set('Authorization', `Bearer ${tokenA}`)

    expect(res.status).toBe(200)
    expect(res.body.data.notifications).toHaveLength(3)
    expect(res.body.data.unreadCount).toBe(2)
  })

  it('user only sees their own notifications', async () => {
    await seedNotification(userAId)
    await seedNotification(userBId)

    const res = await request(app)
      .get('/api/v1/notifications')
      .set('Authorization', `Bearer ${tokenA}`)

    expect(res.body.data.notifications).toHaveLength(1)
    expect(res.body.data.notifications[0].userId).toBe(userAId)
  })

  it('returns 401 without auth', async () => {
    const res = await request(app).get('/api/v1/notifications')
    expect(res.status).toBe(401)
  })
})

// ── PATCH /notifications/:id/read ─────────────────────────────────────────────

describe('PATCH /api/v1/notifications/:id/read', () => {
  it('marks a single notification as read', async () => {
    const n = await seedNotification(userAId, false)

    const res = await request(app)
      .patch(`/api/v1/notifications/${n.id}/read`)
      .set('Authorization', `Bearer ${tokenA}`)

    expect(res.status).toBe(200)
    expect(res.body.data.ok).toBe(true)

    const updated = await prisma.notification.findUnique({ where: { id: n.id } })
    expect(updated?.isRead).toBe(true)
  })

  it('returns 404 when notification belongs to another user', async () => {
    const n = await seedNotification(userBId, false)

    const res = await request(app)
      .patch(`/api/v1/notifications/${n.id}/read`)
      .set('Authorization', `Bearer ${tokenA}`)

    expect(res.status).toBe(404)
  })

  it('returns 404 for non-existent notification id', async () => {
    const res = await request(app)
      .patch('/api/v1/notifications/cmfake00000000000000000000/read')
      .set('Authorization', `Bearer ${tokenA}`)

    expect(res.status).toBe(404)
  })
})

// ── PATCH /notifications/read-all ─────────────────────────────────────────────

describe('PATCH /api/v1/notifications/read-all', () => {
  it('marks all unread notifications as read for the authenticated user', async () => {
    await seedNotification(userAId, false)
    await seedNotification(userAId, false)

    const res = await request(app)
      .patch('/api/v1/notifications/read-all')
      .set('Authorization', `Bearer ${tokenA}`)

    expect(res.status).toBe(200)
    expect(res.body.data.ok).toBe(true)

    const unread = await prisma.notification.count({ where: { userId: userAId, isRead: false } })
    expect(unread).toBe(0)
  })

  it('does not affect another user\'s notifications', async () => {
    await seedNotification(userAId, false)
    await seedNotification(userBId, false)

    await request(app)
      .patch('/api/v1/notifications/read-all')
      .set('Authorization', `Bearer ${tokenA}`)

    const bUnread = await prisma.notification.count({ where: { userId: userBId, isRead: false } })
    expect(bUnread).toBe(1)
  })

  it('unreadCount is 0 after read-all', async () => {
    await seedNotification(userAId, false)
    await seedNotification(userAId, false)

    await request(app)
      .patch('/api/v1/notifications/read-all')
      .set('Authorization', `Bearer ${tokenA}`)

    const res = await request(app)
      .get('/api/v1/notifications')
      .set('Authorization', `Bearer ${tokenA}`)

    expect(res.body.data.unreadCount).toBe(0)
  })
})

// ── S10.5: Event wiring ───────────────────────────────────────────────────────

describe('Notification wiring — booking events', () => {
  it('createBooking emits a BOOKING_CONFIRMED notification', async () => {
    await cleanupPhone('+9647900000196')
    const owner = await prisma.user.create({ data: { phone: '+9647900000196', name: 'BOwner', role: 'SHOP_OWNER' } })
    const shop  = await prisma.shop.create({
      data: {
        ownerId: owner.id, nameEn: 'N Shop', nameAr: 'محل', address: 'St', city: 'Baghdad',
        neighborhood: 'K', neighborhoodAr: 'ك', phone: '+9640000000196',
        lat: 33.3, lng: 44.4, status: 'APPROVED', isActive: true, bookingMode: 'BOTH',
      },
    })
    const service = await prisma.service.create({
      data: { shopId: shop.id, nameEn: 'Cut', nameAr: 'قص', price: 5000, durationMin: 30, category: 'hair' },
    })
    const customerToken = signAccess({ id: userAId, role: 'CUSTOMER', shopId: undefined })

    const slot = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString()
    await request(app)
      .post('/api/v1/bookings')
      .set('Authorization', `Bearer ${customerToken}`)
      .send({ shopId: shop.id, serviceIds: [service.id], slot, paymentMethod: 'ZAINCASH' })

    const notif = await prisma.notification.findFirst({
      where: { userId: userAId, type: 'BOOKING_CONFIRMED' },
    })
    expect(notif).not.toBeNull()

    // cleanup
    await prisma.booking.deleteMany({ where: { shopId: shop.id } })
    await prisma.service.deleteMany({ where: { shopId: shop.id } })
    await prisma.shop.deleteMany({ where: { id: shop.id } })
    await prisma.user.deleteMany({ where: { id: owner.id } })
  })
})
