import { Request, Response, NextFunction } from 'express'
import { ok } from '@/lib/response'
import {
  getQueue, addWalkIn, updateStatus,
  reorderEntry, getCustomerQueueEntry,
} from '@/services/queue.service'
import { createNotification } from '@/services/notification.service'
import { prisma } from '@/config/prisma'
import { AppError } from '@/lib/errors'

async function getShopVipFlag(shopId: string): Promise<boolean> {
  const shop = await prisma.shop.findUnique({ where: { id: shopId }, select: { vipLaneEnabled: true } })
  return shop?.vipLaneEnabled ?? false
}

export async function getQueueHandler(req: Request, res: Response, next: NextFunction) {
  try {
    const shopId = req.params['shopId']!
    const vip = await getShopVipFlag(shopId)
    ok(res, await getQueue(shopId, vip))
  } catch (err) { next(err) }
}

export async function addWalkInHandler(req: Request, res: Response, next: NextFunction) {
  try {
    const shopId = req.params['shopId']!
    const entry = await addWalkIn(shopId, req.body)
    res.status(201).json({ data: entry })
  } catch (err) { next(err) }
}

export async function startServiceHandler(req: Request, res: Response, next: NextFunction) {
  try {
    ok(res, await updateStatus(req.params['entryId']!, 'IN_CHAIR', req.user!))
  } catch (err) { next(err) }
}

export async function doneHandler(req: Request, res: Response, next: NextFunction) {
  try {
    const entry = await updateStatus(req.params['entryId']!, 'DONE', req.user!)
    if (entry.bookingId) {
      const booking = await prisma.booking.findUnique({ where: { id: entry.bookingId } })
      if (booking) {
        await prisma.booking.update({ where: { id: entry.bookingId }, data: { status: 'COMPLETED' } })
      }
    }
    ok(res, entry)
  } catch (err) { next(err) }
}

export async function noShowHandler(req: Request, res: Response, next: NextFunction) {
  try {
    const entry = await updateStatus(req.params['entryId']!, 'NO_SHOW', req.user!)
    if (entry.bookingId) {
      const booking = await prisma.booking.findUnique({ where: { id: entry.bookingId } })
      if (booking) {
        await prisma.booking.update({ where: { id: entry.bookingId }, data: { status: 'NO_SHOW' } })
        await createNotification(
          booking.customerId, 'CANCELLATION',
          'No-Show Recorded', 'تم تسجيل غياب',
          'You were marked as a no-show for your appointment.', 'تم تسجيلك كغائب عن موعدك.',
          { bookingId: booking.id },
        )
      }
    }
    ok(res, entry)
  } catch (err) { next(err) }
}

export async function reorderHandler(req: Request, res: Response, next: NextFunction) {
  try {
    const entryId = req.params['entryId']!
    const { position } = req.body
    if (!position || position < 1) throw new AppError('validation_error', 400)
    const entry = await prisma.queueEntry.findUnique({ where: { id: entryId } })
    if (!entry) throw new AppError('not_found', 404)
    ok(res, await reorderEntry(entry.shopId, entryId, position, req.user!))
  } catch (err) { next(err) }
}

export async function customerQueueHandler(req: Request, res: Response, next: NextFunction) {
  try {
    ok(res, await getCustomerQueueEntry(req.params['bookingId']!, req.user!.id))
  } catch (err) { next(err) }
}
