import { Router } from 'express'
import { z } from 'zod'
import { validate } from '@/middleware/validate'
import { authenticate } from '@/middleware/auth'
import { initiateCashPaymentHandler, getPaymentHandler } from '@/controllers/payment.controller'

const cashSchema = z.object({ bookingId: z.string().cuid() })

export const paymentsRouter = Router()

paymentsRouter.post('/initiate/cash', authenticate, validate(cashSchema), initiateCashPaymentHandler)
paymentsRouter.get('/:id',           authenticate, getPaymentHandler)
