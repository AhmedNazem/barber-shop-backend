import { Request, Response, NextFunction } from 'express'
import { ok } from '@/lib/response'
import { getTopServices, getBarberAnalytics, getDashboardAnalytics, getDashboardActivity, getDashboardStats } from '@/services/dashboard.service'

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
    ok(res, await getDashboardActivity(req.user!.id))
  } catch (err) { next(err) }
}

export async function getDashboardStatsHandler(req: Request, res: Response, next: NextFunction) {
  try {
    ok(res, await getDashboardStats(req.user!.id, req.user!.role, req.user!.shopId))
  } catch (err) { next(err) }
}
