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

const E164_OWNER    = '+9647900000117'
const E164_BARBER   = '+9647900000118'
const E164_CUSTOMER = '+9647900000119'

let ownerId:       string
let ownerToken:    string
let barberToken:   string
let customerToken: string
let shopId:        string
let serviceId:     string
let customerId:    string

beforeEach(async () => {
  await cleanupPhone(E164_OWNER)
  await cleanupPhone(E164_BARBER)
  await cleanupPhone(E164_CUSTOMER)

  const owner = await prisma.user.create({ data: { phone: E164_OWNER, name: 'Owner', role: 'SHOP_OWNER' } })
  ownerId = owner.id
  ownerToken = signAccess({ id: owner.id, role: owner.role })

  const barberUser = await prisma.user.create({ data: { phone: E164_BARBER, name: 'Barber', role: 'BARBER' } })
  barberToken = signAccess({ id: barberUser.id, role: barberUser.role })

  const customer = await prisma.user.create({ data: { phone: E164_CUSTOMER, name: 'Customer', role: 'CUSTOMER' } })
  customerId = customer.id
  customerToken = signAccess({ id: customer.id, role: customer.role })

  const shop = await prisma.shop.create({
    data: {
      ownerId, nameEn: 'Queue Shop', nameAr: 'محل', address: 'St', city: 'Baghdad',
      neighborhood: 'K', neighborhoodAr: 'ك', phone: '+9640000000117',
      lat: 33.34, lng: 44.40, status: 'APPROVED', isActive: true,
    },
  })
  shopId = shop.id

  const service = await prisma.service.create({
    data: { shopId, nameEn: 'Haircut', nameAr: 'قص', price: 5000, durationMin: 30, category: 'hair' },
  })
  serviceId = service.id
})

afterEach(async () => {
  await prisma.queueEntry.deleteMany({ where: { shopId } })
  await prisma.booking.deleteMany({ where: { shopId } })
  await prisma.reliabilityRecord.deleteMany({ where: { userId: customerId } })
  await prisma.shop.deleteMany({ where: { ownerId } })
  await cleanupPhone(E164_OWNER)
  await cleanupPhone(E164_BARBER)
  await cleanupPhone(E164_CUSTOMER)
})

// ── GET /shops/:shopId/queue ───────────────────────────────────────────────────

describe('GET /api/v1/shops/:shopId/queue', () => {
  it('returns 200 with empty array when queue is empty', async () => {
    const res = await request(app)
      .get(`/api/v1/shops/${shopId}/queue`)
      .set('Authorization', `Bearer ${ownerToken}`)

    expect(res.status).toBe(200)
    expect(res.body.data).toEqual([])
  })

  it('returns 200 with active entries including computed status and wait', async () => {
    await prisma.queueEntry.create({
      data: { shopId, customerName: 'Ali', serviceIds: [serviceId], position: 1, estimatedWait: 30 },
    })

    const res = await request(app)
      .get(`/api/v1/shops/${shopId}/queue`)
      .set('Authorization', `Bearer ${ownerToken}`)

    expect(res.status).toBe(200)
    expect(res.body.data).toHaveLength(1)
    expect(res.body.data[0].status).toBe('next')
    expect(res.body.data[0].position).toBe(1)
    expect(res.body.data[0].estimatedWait).toBe(0)
  })

  it('returns 403 when customer tries to access shop queue', async () => {
    const res = await request(app)
      .get(`/api/v1/shops/${shopId}/queue`)
      .set('Authorization', `Bearer ${customerToken}`)

    expect(res.status).toBe(403)
  })

  it('barber JWT can also access the queue', async () => {
    const res = await request(app)
      .get(`/api/v1/shops/${shopId}/queue`)
      .set('Authorization', `Bearer ${barberToken}`)

    expect(res.status).toBe(200)
  })
})

// ── POST /shops/:shopId/queue/walk-in ─────────────────────────────────────────

describe('POST /api/v1/shops/:shopId/queue/walk-in', () => {
  it('adds walk-in and returns 201 with entry', async () => {
    const res = await request(app)
      .post(`/api/v1/shops/${shopId}/queue/walk-in`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({ customerName: 'Walk-In Ahmed', serviceIds: [serviceId] })

    expect(res.status).toBe(201)
    expect(res.body.data.customerName).toBe('Walk-In Ahmed')
    expect(res.body.data.position).toBe(1)
    expect(res.body.data.status).toBe('WAITING')
  })

  it('VIP entry gets sorted to front of queue (position 1)', async () => {
    // Add a regular entry first
    await prisma.queueEntry.create({
      data: { shopId, customerName: 'Regular', serviceIds: [serviceId], position: 1, estimatedWait: 30 },
    })

    await request(app)
      .post(`/api/v1/shops/${shopId}/queue/walk-in`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({ customerName: 'VIP Customer', serviceIds: [serviceId], isVip: true })

    const queue = await request(app)
      .get(`/api/v1/shops/${shopId}/queue`)
      .set('Authorization', `Bearer ${ownerToken}`)

    expect(queue.body.data[0].customerName).toBe('VIP Customer')
    expect(queue.body.data[0].isVip).toBe(true)
  })

  it('returns 400 when customerName is missing', async () => {
    const res = await request(app)
      .post(`/api/v1/shops/${shopId}/queue/walk-in`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({ serviceIds: [serviceId] })

    expect(res.status).toBe(400)
  })
})

// ── PATCH /queue/:entryId/start ───────────────────────────────────────────────

describe('PATCH /api/v1/queue/:entryId/start', () => {
  it('moves entry to IN_CHAIR', async () => {
    const entry = await prisma.queueEntry.create({
      data: { shopId, customerName: 'Ali', serviceIds: [serviceId], position: 1, estimatedWait: 30 },
    })

    const res = await request(app)
      .patch(`/api/v1/queue/${entry.id}/start`)
      .set('Authorization', `Bearer ${barberToken}`)

    expect(res.status).toBe(200)
    expect(res.body.data.status).toBe('IN_CHAIR')
  })

  it('returns 404 for unknown entry', async () => {
    const res = await request(app)
      .patch('/api/v1/queue/nonexistent-entry-id/start')
      .set('Authorization', `Bearer ${barberToken}`)

    expect(res.status).toBe(404)
  })
})

// ── PATCH /queue/:entryId/done ────────────────────────────────────────────────

describe('PATCH /api/v1/queue/:entryId/done', () => {
  it('marks entry DONE and updates linked booking + reliability', async () => {
    const booking = await prisma.booking.create({
      data: {
        customerId, shopId, slot: new Date('2025-12-15T10:00:00Z'),
        totalPrice: 5000, depositPaid: 0, paymentMethod: 'ZAINCASH',
      },
    })
    const entry = await prisma.queueEntry.create({
      data: {
        shopId, customerName: 'Ali', serviceIds: [serviceId],
        position: 1, estimatedWait: 30, bookingId: booking.id,
      },
    })

    const res = await request(app)
      .patch(`/api/v1/queue/${entry.id}/done`)
      .set('Authorization', `Bearer ${barberToken}`)

    expect(res.status).toBe(200)
    expect(res.body.data.status).toBe('DONE')

    const updatedBooking = await prisma.booking.findUnique({ where: { id: booking.id } })
    expect(updatedBooking?.status).toBe('COMPLETED')

    const reliability = await prisma.reliabilityRecord.findUnique({ where: { userId: customerId } })
    expect(reliability?.score).toBe(100)
  })

  it('marks entry DONE even without a linked booking', async () => {
    const entry = await prisma.queueEntry.create({
      data: { shopId, customerName: 'Walk-In', serviceIds: [serviceId], position: 1, estimatedWait: 30 },
    })

    const res = await request(app)
      .patch(`/api/v1/queue/${entry.id}/done`)
      .set('Authorization', `Bearer ${barberToken}`)

    expect(res.status).toBe(200)
    expect(res.body.data.status).toBe('DONE')
  })
})

// ── PATCH /queue/:entryId/no-show ─────────────────────────────────────────────

describe('PATCH /api/v1/queue/:entryId/no-show', () => {
  it('marks entry NO_SHOW and penalises reliability', async () => {
    const booking = await prisma.booking.create({
      data: {
        customerId, shopId, slot: new Date('2025-12-15T11:00:00Z'),
        totalPrice: 5000, depositPaid: 0, paymentMethod: 'ZAINCASH',
      },
    })
    const entry = await prisma.queueEntry.create({
      data: {
        shopId, customerName: 'No-Show', serviceIds: [serviceId],
        position: 1, estimatedWait: 30, bookingId: booking.id,
      },
    })

    const res = await request(app)
      .patch(`/api/v1/queue/${entry.id}/no-show`)
      .set('Authorization', `Bearer ${barberToken}`)

    expect(res.status).toBe(200)
    expect(res.body.data.status).toBe('NO_SHOW')

    const updatedBooking = await prisma.booking.findUnique({ where: { id: booking.id } })
    expect(updatedBooking?.status).toBe('NO_SHOW')

    const reliability = await prisma.reliabilityRecord.findUnique({ where: { userId: customerId } })
    expect(reliability?.score).toBe(80)
    expect(reliability?.noShowCount).toBe(1)
  })
})

// ── PATCH /queue/:entryId/reorder ─────────────────────────────────────────────

describe('PATCH /api/v1/queue/:entryId/reorder', () => {
  it('moves entry to requested position', async () => {
    const e1 = await prisma.queueEntry.create({
      data: { shopId, customerName: 'First',  serviceIds: [serviceId], position: 1, estimatedWait: 30 },
    })
    const e2 = await prisma.queueEntry.create({
      data: { shopId, customerName: 'Second', serviceIds: [serviceId], position: 2, estimatedWait: 30 },
    })

    const res = await request(app)
      .patch(`/api/v1/queue/${e1.id}/reorder`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({ position: 2 })

    expect(res.status).toBe(200)

    const moved = await prisma.queueEntry.findUnique({ where: { id: e2.id } })
    expect(moved?.position).toBe(1)
  })

  it('returns 400 when position is 0 or missing', async () => {
    const entry = await prisma.queueEntry.create({
      data: { shopId, customerName: 'Ali', serviceIds: [serviceId], position: 1, estimatedWait: 30 },
    })

    const res = await request(app)
      .patch(`/api/v1/queue/${entry.id}/reorder`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({ position: 0 })

    expect(res.status).toBe(400)
  })
})
