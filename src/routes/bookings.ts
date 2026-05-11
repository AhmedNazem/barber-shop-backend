import { Router } from 'express'
import { z } from 'zod'
import { validate } from '@/middleware/validate'
import { authenticate } from '@/middleware/auth'
import { cancelBookingHandler, getBookingByIdHandler, getBookingsHandler, createBookingHandler, downloadReceiptHandler } from '@/controllers/booking.controller'
import { submitProofHandler } from '@/controllers/manual-payment.controller'

const createBookingSchema = z.object({
  shopId:        z.string().min(1),
  barberId:      z.string().min(1).optional(),
  serviceIds:    z.array(z.string().min(1)).min(1),
  slot:          z.string().datetime(),
  paymentMethod: z.enum(['CASH', 'ZAINCASH', 'FIB', 'PAYTABS']),
})

export const bookingsRouter = Router()

bookingsRouter.get('/',               authenticate, getBookingsHandler)
bookingsRouter.get('/:id',            authenticate, getBookingByIdHandler)
bookingsRouter.patch('/:id/cancel',   authenticate, cancelBookingHandler)
bookingsRouter.post('/',              authenticate, validate(createBookingSchema), createBookingHandler)
bookingsRouter.post('/:id/payment-proof', authenticate, submitProofHandler)
bookingsRouter.get( '/:id/receipt',       authenticate, downloadReceiptHandler)
