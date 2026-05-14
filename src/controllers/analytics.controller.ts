import { Request, Response, NextFunction } from 'express'
import { ok } from '@/lib/response'
import { getAdminKpis, getAdminRevenue, getAdminTopShops, getAdminPeakHours } from '@/services/analytics.service'
import { getAdminPayouts } from '@/services/payout.service'

export async function getKpisHandler(req: Request, res: Response, next: NextFunction) {
  try {
    ok(res, await getAdminKpis())
  } catch (err) { next(err) }
}

export async function getRevenueHandler(req: Request, res: Response, next: NextFunction) {
  try {
    ok(res, await getAdminRevenue())
  } catch (err) { next(err) }
}

export async function getTopShopsHandler(req: Request, res: Response, next: NextFunction) {
  try {
    const limit = Math.min(20, Math.max(1, parseInt(String(req.query['limit'] ?? '5'), 10)))
    ok(res, await getAdminTopShops(limit))
  } catch (err) { next(err) }
}

export async function getPeakHoursHandler(req: Request, res: Response, next: NextFunction) {
  try {
    ok(res, await getAdminPeakHours())
  } catch (err) { next(err) }
}

export async function getAdminPayoutsHandler(req: Request, res: Response, next: NextFunction) {
  try {
    const now   = new Date()
    const year  = parseInt(String(req.query['year']  ?? now.getFullYear()),  10)
    const month = parseInt(String(req.query['month'] ?? now.getMonth() + 1), 10)
    ok(res, await getAdminPayouts(year, month))
  } catch (err) { next(err) }
}
