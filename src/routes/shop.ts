import { Router } from 'express'
import { z } from 'zod'
import { validate } from '@/middleware/validate'
import { authenticate } from '@/middleware/auth'
import { requireRole } from '@/middleware/require-role'
import { getShopStatusHandler, getShopPlanHandler, updateBookingModeHandler } from '@/controllers/shop.controller'

const bookingModeSchema = z.object({
  mode: z.enum(['QUEUE_ONLY', 'BOOKING_ONLY', 'BOTH']),
})

export const shopRouter = Router()

shopRouter.get('/status',                     authenticate, requireRole('SHOP_OWNER'), getShopStatusHandler)
shopRouter.get('/:id/plan',                   authenticate, requireRole('SHOP_OWNER'), getShopPlanHandler)
shopRouter.patch('/:id/booking-mode',         authenticate, requireRole('SHOP_OWNER'), validate(bookingModeSchema), updateBookingModeHandler)
