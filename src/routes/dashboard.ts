import { Router } from 'express'
import { authenticate } from '@/middleware/auth'
import { requireRole } from '@/middleware/require-role'
import { getBarberAnalyticsHandler, getDashboardAnalyticsHandler, getDashboardActivityHandler, getDashboardStatsHandler } from '@/controllers/dashboard.controller'

export const dashboardRouter = Router()

dashboardRouter.get('/stats',     authenticate, requireRole('SHOP_OWNER', 'BARBER'), getDashboardStatsHandler)
dashboardRouter.get('/activity',  authenticate, requireRole('SHOP_OWNER'),           getDashboardActivityHandler)
dashboardRouter.get('/analytics',         authenticate, requireRole('SHOP_OWNER', 'BARBER'), getDashboardAnalyticsHandler)
dashboardRouter.get('/analytics/barbers', authenticate, requireRole('SHOP_OWNER'),           getBarberAnalyticsHandler)
