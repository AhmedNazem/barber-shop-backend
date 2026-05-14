import { Request, Response, NextFunction } from 'express'
import { ok } from '@/lib/response'
import { initiateCashPayment } from '@/services/payment.service'
import { prisma } from '@/config/prisma'
import { AppError } from '@/lib/errors'

export async function initiateCashPaymentHandler(req: Request, res: Response, next: NextFunction) {
  try {
    const payment = await initiateCashPayment(req.user!.id, req.body.bookingId)
    res.status(201).json({ data: payment })
  } catch (err) { next(err) }
}

export async function getPaymentHandler(req: Request, res: Response, next: NextFunction) {
  try {
    const payment = await prisma.payment.findUnique({ where: { id: req.params['id'] } })
    if (!payment) throw new AppError('not_found', 404)

    const booking = await prisma.booking.findUnique({
      where: { id: payment.bookingId },
      select: { customerId: true, shopId: true },
    })
    if (!booking) throw new AppError('not_found', 404)

    const user = req.user!
    if (user.role === 'CUSTOMER' && booking.customerId !== user.id) throw new AppError('forbidden', 403)
    if ((user.role === 'BARBER' || user.role === 'SHOP_OWNER') && booking.shopId !== user.shopId) {
      throw new AppError('forbidden', 403)
    }

    ok(res, payment)
  } catch (err) { next(err) }
}
