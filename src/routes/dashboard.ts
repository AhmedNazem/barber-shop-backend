import { Router } from 'express'
import { authenticate } from '@/middleware/auth'
import { requireRole } from '@/middleware/require-role'
import { getDashboardActivityHandler, getDashboardStatsHandler } from '@/controllers/dashboard.controller'

export const dashboardRouter = Router()

dashboardRouter.get('/stats',    authenticate, requireRole('SHOP_OWNER', 'BARBER'), getDashboardStatsHandler)
dashboardRouter.get('/activity', authenticate, requireRole('SHOP_OWNER'),           getDashboardActivityHandler)
