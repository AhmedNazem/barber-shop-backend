import { Request, Response, NextFunction } from 'express'
import { ok } from '@/lib/response'
import { getDashboardStats } from '@/services/dashboard.service'

export async function getDashboardStatsHandler(req: Request, res: Response, next: NextFunction) {
  try {
    ok(res, await getDashboardStats(req.user!.id, req.user!.role, req.user!.shopId))
  } catch (err) { next(err) }
}
