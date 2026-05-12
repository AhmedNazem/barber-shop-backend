import { Request, Response, NextFunction } from 'express'
import { ok } from '@/lib/response'
import { recordWalkInSale, getPeakHours, getTopServices, getBarberAnalytics, getDashboardAnalytics, getDashboardActivity, getDashboardStats, getDashboardUpcoming, getDashboardAppointments, getDashboardBarbers } from '@/services/dashboard.service'
import { getQueue } from '@/services/queue.service'
import { AppError } from '@/lib/errors'
import { prisma } from '@/config/prisma'

export async function recordWalkInSaleHandler(req: Request, res: Response, next: NextFunction) {
  try {
    const booking = await recordWalkInSale(req.user!.id, req.user!.shopId, req.body)
    res.status(201).json({ data: booking })
  } catch (err) { next(err) }
}

export async function getPeakHoursHandler(req: Request, res: Response, next: NextFunction) {
  try {
    ok(res, await getPeakHours(req.user!.id, req.user!.role, req.user!.shopId))
  } catch (err) { next(err) }
}

export async function getTopServicesHandler(req: Request, res: Response, next: NextFunction) {
  try {
    ok(res, await getTopServices(req.user!.id, req.user!.role, req.user!.shopId))
  } catch (err) { next(err) }
}

export async function getBarberAnalyticsHandler(req: Request, res: Response, next: NextFunction) {
  try {
    ok(res, await getBarberAnalytics(req.user!.shopId))
  } catch (err) { next(err) }
}

export async function getDashboardAnalyticsHandler(req: Request, res: Response, next: NextFunction) {
  try {
    const range = (req.query['range'] as string) || 'month'
    const start = req.query['start'] as string | undefined
    const end   = req.query['end']   as string | undefined
    ok(res, await getDashboardAnalytics(req.user!.id, req.user!.role, req.user!.shopId, range, start, end))
  } catch (err) { next(err) }
}

export async function getDashboardActivityHandler(req: Request, res: Response, next: NextFunction) {
  try {
    ok(res, await getDashboardActivity(req.user!.id, req.user!.shopId))
  } catch (err) { next(err) }
}

export async function getDashboardUpcomingHandler(req: Request, res: Response, next: NextFunction) {
  try {
    const limit = Math.min(10, Number(req.query['limit']) || 5)
    ok(res, await getDashboardUpcoming(req.user!.shopId, limit))
  } catch (err) { next(err) }
}

export async function getDashboardStatsHandler(req: Request, res: Response, next: NextFunction) {
  try {
    ok(res, await getDashboardStats(req.user!.id, req.user!.role, req.user!.shopId))
  } catch (err) { next(err) }
}

export async function getDashboardBarbersHandler(req: Request, res: Response, next: NextFunction) {
  try {
    ok(res, await getDashboardBarbers(req.user!.shopId))
  } catch (err) { next(err) }
}

export async function getDashboardAppointmentsHandler(req: Request, res: Response, next: NextFunction) {
  try {
    const dateFrom = (req.query['dateFrom'] as string) || new Date().toISOString().slice(0, 10)
    const dateTo   = (req.query['dateTo']   as string) || dateFrom
    const barberId = req.query['barberId']  as string | undefined
    ok(res, await getDashboardAppointments(req.user!.shopId, dateFrom, dateTo, barberId))
  } catch (err) { next(err) }
}

export async function getDashboardQueueHandler(req: Request, res: Response, next: NextFunction) {
  try {
    const shopId = req.user!.shopId
    if (!shopId) throw new AppError('forbidden', 403)
    const shop = await prisma.shop.findUnique({ where: { id: shopId }, select: { vipLaneEnabled: true } })
    ok(res, await getQueue(shopId, shop?.vipLaneEnabled ?? false))
  } catch (err) { next(err) }
}
