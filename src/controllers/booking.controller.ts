import { Request, Response, NextFunction } from 'express'
import { ok } from '@/lib/response'
import { getBookingById, getBookings, createBooking } from '@/services/booking.service'

export async function getBookingByIdHandler(req: Request, res: Response, next: NextFunction) {
  try {
    ok(res, await getBookingById(req.params['id']!, req.user!.id))
  } catch (err) { next(err) }
}

export async function getBookingsHandler(req: Request, res: Response, next: NextFunction) {
  try {
    ok(res, await getBookings(req.user!.id))
  } catch (err) { next(err) }
}

export async function createBookingHandler(req: Request, res: Response, next: NextFunction) {
  try {
    const booking = await createBooking(req.user!.id, req.body)
    res.status(201).json({ data: booking })
  } catch (err) {
    next(err)
  }
}
