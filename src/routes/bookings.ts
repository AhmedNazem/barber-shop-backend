import { Router } from 'express'
import { z } from 'zod'
import { validate } from '@/middleware/validate'
import { authenticate } from '@/middleware/auth'
import { requireRole } from '@/middleware/require-role'
import { cancelBookingHandler, getBookingByIdHandler, getBookingsHandler, createBookingHandler } from '@/controllers/booking.controller'

const createBookingSchema = z.object({
  shopId:        z.string().cuid(),
  barberId:      z.string().cuid().optional(),
  serviceIds:    z.array(z.string().cuid()).min(1),
  slot:          z.string().datetime(),
  paymentMethod: z.enum(['CASH', 'ZAINCASH', 'FIB', 'PAYTABS']),
})

export const bookingsRouter = Router()

bookingsRouter.get('/',    authenticate, requireRole('CUSTOMER'), getBookingsHandler)
bookingsRouter.get('/:id',         authenticate, requireRole('CUSTOMER'), getBookingByIdHandler)
bookingsRouter.patch('/:id/cancel', authenticate, requireRole('CUSTOMER'), cancelBookingHandler)
bookingsRouter.post('/',  authenticate, requireRole('CUSTOMER'), validate(createBookingSchema), createBookingHandler)
