import { Request, Response, NextFunction } from 'express'
import { ok } from '@/lib/response'
import { cancelBooking, getBookingById, getBookings, createBooking, getBookingForReceipt } from '@/services/booking.service'
import { generateReceiptHtml } from '@/lib/receipt'

export async function cancelBookingHandler(req: Request, res: Response, next: NextFunction) {
  try {
    await cancelBooking(req.params['id']!, req.user!.id)
    ok(res, { cancelled: true })
  } catch (err) { next(err) }
}

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

export async function downloadReceiptHandler(req: Request, res: Response, next: NextFunction) {
  try {
    const booking = await getBookingForReceipt(req.params['id']!, req.user!.id)
    const html = generateReceiptHtml(booking)
    const filename = `receipt-${booking.id.slice(-8).toUpperCase()}.html`
    res.setHeader('Content-Type', 'text/html; charset=utf-8')
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`)
    res.send(html)
  } catch (err) { next(err) }
}
