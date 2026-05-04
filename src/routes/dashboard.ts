import { Router } from 'express'
import { z } from 'zod'
import { validate } from '@/middleware/validate'
import { authenticate } from '@/middleware/auth'
import { requireRole } from '@/middleware/require-role'
import { requirePlan } from '@/middleware/require-plan'
import { recordWalkInSaleHandler, getPeakHoursHandler, getTopServicesHandler, getBarberAnalyticsHandler, getDashboardAnalyticsHandler, getDashboardActivityHandler, getDashboardStatsHandler } from '@/controllers/dashboard.controller'

const walkInSaleSchema = z.object({
  serviceIds: z.array(z.string().cuid()).min(1),
  barberId:   z.string().cuid().optional(),
  totalPrice: z.number().int().min(1),
  note:       z.string().optional(),
})

export const dashboardRouter = Router()

dashboardRouter.get('/stats',     authenticate, requireRole('SHOP_OWNER', 'BARBER'), getDashboardStatsHandler)
dashboardRouter.get('/activity',  authenticate, requireRole('SHOP_OWNER'),           getDashboardActivityHandler)
dashboardRouter.get('/analytics',               authenticate, requireRole('SHOP_OWNER', 'BARBER'), requirePlan('PRO'), getDashboardAnalyticsHandler)
dashboardRouter.get('/analytics/barbers',       authenticate, requireRole('SHOP_OWNER'),           requirePlan('PRO'), getBarberAnalyticsHandler)
dashboardRouter.get('/analytics/top-services',  authenticate, requireRole('SHOP_OWNER', 'BARBER'), requirePlan('PRO'), getTopServicesHandler)
dashboardRouter.get('/analytics/peak-hours',    authenticate, requireRole('SHOP_OWNER', 'BARBER'), requirePlan('PRO'), getPeakHoursHandler)
dashboardRouter.post('/walk-in-sale',           authenticate, requireRole('SHOP_OWNER', 'BARBER'), validate(walkInSaleSchema), recordWalkInSaleHandler)
