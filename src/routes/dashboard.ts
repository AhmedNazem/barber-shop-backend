import { Router } from 'express'
import { z } from 'zod'
import { validate } from '@/middleware/validate'
import { authenticate } from '@/middleware/auth'
import { requireRole } from '@/middleware/require-role'
import { requirePlan } from '@/middleware/require-plan'
import { requireShopStatus } from '@/middleware/require-shop-status'
import { recordWalkInSaleHandler, getPeakHoursHandler, getTopServicesHandler, getBarberAnalyticsHandler, getDashboardAnalyticsHandler, getDashboardActivityHandler, getDashboardStatsHandler, getDashboardQueueHandler, getDashboardUpcomingHandler, getDashboardAppointmentsHandler, getDashboardBarbersHandler } from '@/controllers/dashboard.controller'

const walkInSaleSchema = z.object({
  serviceIds: z.array(z.string().cuid()).min(1),
  barberId:   z.string().cuid().optional(),
  totalPrice: z.number().int().min(1),
  note:       z.string().optional(),
})

export const dashboardRouter = Router()

const shopGuard = [authenticate, requireShopStatus()]

dashboardRouter.get('/stats',     ...shopGuard, requireRole('SHOP_OWNER', 'BARBER'), getDashboardStatsHandler)
dashboardRouter.get('/upcoming',  ...shopGuard, requireRole('SHOP_OWNER', 'BARBER'), getDashboardUpcomingHandler)
dashboardRouter.get('/queue',     ...shopGuard, requireRole('SHOP_OWNER', 'BARBER'), getDashboardQueueHandler)
dashboardRouter.get('/activity',  ...shopGuard, requireRole('SHOP_OWNER'),           getDashboardActivityHandler)
dashboardRouter.get('/analytics',              ...shopGuard, requireRole('SHOP_OWNER', 'BARBER'), requirePlan('PRO'), getDashboardAnalyticsHandler)
dashboardRouter.get('/analytics/barbers',      ...shopGuard, requireRole('SHOP_OWNER'),           requirePlan('PRO'), getBarberAnalyticsHandler)
dashboardRouter.get('/analytics/top-services', ...shopGuard, requireRole('SHOP_OWNER', 'BARBER'), requirePlan('PRO'), getTopServicesHandler)
dashboardRouter.get('/analytics/peak-hours',   ...shopGuard, requireRole('SHOP_OWNER', 'BARBER'), requirePlan('PRO'), getPeakHoursHandler)
dashboardRouter.get('/appointments',   ...shopGuard, requireRole('SHOP_OWNER', 'BARBER'), getDashboardAppointmentsHandler)
dashboardRouter.get('/barbers',        ...shopGuard, requireRole('SHOP_OWNER', 'BARBER'), getDashboardBarbersHandler)
dashboardRouter.post('/walk-in-sale',          ...shopGuard, requireRole('SHOP_OWNER', 'BARBER'), validate(walkInSaleSchema), recordWalkInSaleHandler)
