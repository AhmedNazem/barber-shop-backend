import { Request, Response, NextFunction } from 'express'
import { ok } from '@/lib/response'
import { getDashboardActivity, getDashboardStats } from '@/services/dashboard.service'

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
