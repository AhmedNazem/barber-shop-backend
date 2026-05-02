import { Router } from 'express'
import { authenticate } from '@/middleware/auth'
import { requireRole } from '@/middleware/require-role'
import { getPeakHoursHandler, getTopServicesHandler, getBarberAnalyticsHandler, getDashboardAnalyticsHandler, getDashboardActivityHandler, getDashboardStatsHandler } from '@/controllers/dashboard.controller'

export const dashboardRouter = Router()

dashboardRouter.get('/stats',     authenticate, requireRole('SHOP_OWNER', 'BARBER'), getDashboardStatsHandler)
dashboardRouter.get('/activity',  authenticate, requireRole('SHOP_OWNER'),           getDashboardActivityHandler)
dashboardRouter.get('/analytics',         authenticate, requireRole('SHOP_OWNER', 'BARBER'), getDashboardAnalyticsHandler)
dashboardRouter.get('/analytics/barbers',       authenticate, requireRole('SHOP_OWNER'),           getBarberAnalyticsHandler)
dashboardRouter.get('/analytics/top-services',  authenticate, requireRole('SHOP_OWNER', 'BARBER'), getTopServicesHandler)
dashboardRouter.get('/analytics/peak-hours',    authenticate, requireRole('SHOP_OWNER', 'BARBER'), getPeakHoursHandler)
