import { Request, Response, NextFunction } from 'express'
import { createBooking } from '@/services/booking.service'

export async function createBookingHandler(req: Request, res: Response, next: NextFunction) {
  try {
    const booking = await createBooking(req.user!.id, req.body)
    res.status(201).json({ data: booking })
  } catch (err) {
    next(err)
  }
}
