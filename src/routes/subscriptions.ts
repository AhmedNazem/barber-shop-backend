import { Router } from 'express'
import { z } from 'zod'
import { validate } from '@/middleware/validate'
import { authenticate } from '@/middleware/auth'
import { requireRole } from '@/middleware/require-role'
import {
  handleRequestPlanPayment,
  handleListShopPlanPayments,
} from '@/controllers/plan-payment.controller'

const requestSchema = z.object({
  plan:          z.enum(['STARTER', 'PRO']),
  months:        z.number().int().min(1).max(12).default(1),
  method:        z.string().min(1).max(50),
  referenceNote: z.string().max(200).optional(),
})

export const subscriptionsRouter = Router()

const guard = [authenticate, requireRole('SHOP_OWNER')]

subscriptionsRouter.post('/request', ...guard, validate(requestSchema), handleRequestPlanPayment)
subscriptionsRouter.get( '/history', ...guard,                          handleListShopPlanPayments)
