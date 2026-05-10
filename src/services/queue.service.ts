import { prisma } from '@/config/prisma'
import { AppError } from '@/lib/errors'
import { QueueStatus } from '@prisma/client'
import { applyReliabilityEvent } from '@/services/reliability.service'
import { earnPoints } from '@/services/loyalty.service'

const ACTIVE_STATUSES: QueueStatus[] = ['WAITING', 'IN_CHAIR']

// S0.5-A: map DB enum → frontend contract
function mapStatus(entry: { status: QueueStatus; position: number }) {
  if (entry.status === 'DONE') return 'completed'
  if (entry.status === 'NO_SHOW') return 'no_show'
  if (entry.status === 'IN_CHAIR') return 'in_chair'
  if (entry.status === 'WAITING' && entry.position === 1) return 'next'
  return 'waiting'
}

function calcWait(entries: { estimatedWait: number }[], upToIndex: number): number {
  return entries.slice(0, upToIndex).reduce((s, e) => s + e.estimatedWait, 0)
}

async function getServiceDuration(serviceIds: string[]): Promise<number> {
  if (!serviceIds.length) return 30
  const services = await prisma.service.findMany({
    where: { id: { in: serviceIds } },
    select: { durationMin: true },
  })
  return services.reduce((s, sv) => s + sv.durationMin, 0) || 30
}

async function rebuildWaitTimes(shopId: string, tx = prisma as typeof prisma) {
  const waiting = await (tx as typeof prisma).queueEntry.findMany({
    where: { shopId, status: 'WAITING' },
    orderBy: [{ isVip: 'desc' }, { position: 'asc' }],
  })
  let cumulative = 0
  for (const entry of waiting) {
    await (tx as typeof prisma).queueEntry.update({
      where: { id: entry.id },
      data: { estimatedWait: cumulative },
    })
    cumulative += entry.estimatedWait || 30
  }
}

export async function getQueue(shopId: string, vipLaneEnabled: boolean) {
  const entries = await prisma.queueEntry.findMany({
    where:   { shopId, status: { in: ACTIVE_STATUSES } },
    orderBy: [{ isVip: 'desc' }, { position: 'asc' }],
    take:    100,
  })

  return entries.map((e, i) => ({
    id:           e.id,
    customerName: e.customerName,
    barberId:     e.barberId,
    isVip:        e.isVip,
    status:       mapStatus({ status: e.status, position: i + 1 }),
    estimatedWait: calcWait(entries, i),
    position:     i + 1,
  }))
}

export async function addWalkIn(
  shopId: string,
  data: { customerName: string; serviceIds: string[]; barberId?: string; isVip?: boolean },
) {
  const last = await prisma.queueEntry.findFirst({
    where: { shopId, status: { in: ACTIVE_STATUSES } },
    orderBy: { position: 'desc' },
  })
  const duration = await getServiceDuration(data.serviceIds)
  const position = (last?.position ?? 0) + 1

  return prisma.queueEntry.create({
    data: {
      shopId,
      customerName:  data.customerName,
      serviceIds:    data.serviceIds,
      barberId:      data.barberId,
      isVip:         data.isVip ?? false,
      position,
      estimatedWait: duration,
    },
  })
}

export async function updateStatus(
  entryId: string,
  status: QueueStatus,
  actor: { role: string; shopId?: string | null }
) {
  const entry = await prisma.queueEntry.findUnique({
    where:   { id: entryId },
    include: { booking: { select: { customerId: true, totalPrice: true } } },
  })
  if (!entry) throw new AppError('not_found', 404)

  if (actor.role !== 'ADMIN' && entry.shopId !== actor.shopId) {
    throw new AppError('forbidden', 403)
  }

  const updated = await prisma.queueEntry.update({ where: { id: entryId }, data: { status } })

  const customerId = entry.booking?.customerId
  if (customerId) {
    if (status === 'DONE') {
      await applyReliabilityEvent(customerId, 'COMPLETION')
      await earnPoints(customerId, entry.booking!.totalPrice, entry.bookingId ?? undefined)
    } else if (status === 'NO_SHOW') {
      await applyReliabilityEvent(customerId, 'NO_SHOW')
    }
  }

  return updated
}

export async function reorderEntry(
  shopId: string,
  entryId: string,
  newPosition: number,
  actor: { role: string; shopId?: string | null }
) {
  return prisma.$transaction(async (tx) => {
    const entries = await tx.queueEntry.findMany({
      where: { shopId, status: 'WAITING' },
      orderBy: { position: 'asc' },
    })
    const target = entries.find(e => e.id === entryId)
    if (!target) throw new AppError('not_found', 404)

    if (actor.role !== 'ADMIN' && target.shopId !== actor.shopId) {
      throw new AppError('forbidden', 403)
    }

    const reordered = entries.filter(e => e.id !== entryId)
    reordered.splice(newPosition - 1, 0, target)

    for (let i = 0; i < reordered.length; i++) {
      await tx.queueEntry.update({ where: { id: reordered[i]!.id }, data: { position: i + 1 } })
    }
    return reordered
  }, { timeout: 30000 })
}

export async function getCustomerQueueEntry(bookingId: string, customerId: string) {
  const entry = await prisma.queueEntry.findUnique({
    where: { bookingId },
    include: {
      booking: {
        select: {
          customerId: true,
          barberName: true,
          shop:     { select: { nameEn: true, nameAr: true } },
          services: { select: { nameEn: true, nameAr: true }, take: 1 },
        },
      },
    },
  })
  if (!entry) throw new AppError('not_found', 404)
  if (entry.booking?.customerId !== customerId) throw new AppError('forbidden', 403)

  const [ahead, totalInQueue] = await Promise.all([
    prisma.queueEntry.count({
      where: { shopId: entry.shopId, status: 'WAITING', position: { lt: entry.position } },
    }),
    prisma.queueEntry.count({
      where: { shopId: entry.shopId, status: 'WAITING' },
    }),
  ])

  const position = ahead + 1
  const service  = entry.booking?.services[0]

  return {
    bookingId,
    position,
    totalInQueue,
    estimatedWaitMin: ahead * (entry.estimatedWait || 30),
    status:       mapStatus({ status: entry.status, position }),
    shopName:     entry.booking?.shop.nameEn ?? '',
    shopNameAr:   entry.booking?.shop.nameAr ?? '',
    barberName:   entry.booking?.barberName  ?? 'Any Barber',
    serviceName:  service?.nameEn ?? '',
    serviceNameAr: service?.nameAr ?? '',
  }
}
