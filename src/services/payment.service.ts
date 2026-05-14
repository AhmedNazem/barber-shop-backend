import { randomBytes } from 'crypto'
import { prisma } from '@/config/prisma'
import { AppError } from '@/lib/errors'
import { Prisma, PaymentProvider } from '@prisma/client'
import { createNotification } from '@/services/notification.service'

function makeIdempotencyKey(prefix: string): string {
  return `${prefix}-${randomBytes(8).toString('hex')}`
}

export async function initiatePayment(
  bookingId: string,
  provider: PaymentProvider,
  amount: number,
  depositAmount: number,
  idempotencyKey?: string,
) {
  const key = idempotencyKey ?? makeIdempotencyKey(provider)

  const existing = await prisma.payment.findUnique({ where: { idempotencyKey: key } })
  if (existing) return existing

  return prisma.payment.create({
    data: {
      bookingId,
      provider,
      status: 'PENDING',
      amount,
      depositAmount,
      remainingAmount: amount - depositAmount,
      idempotencyKey: key,
      expiresAt: new Date(Date.now() + 30 * 60 * 1000),
    },
  })
}

export async function confirmPayment(
  paymentId: string,
  gatewayTxId: string,
  gatewayResponse?: Prisma.InputJsonValue,
) {
  const payment = await prisma.payment.findUnique({ where: { id: paymentId } })
  if (!payment) throw new AppError('not_found', 404)
  if (payment.status === 'COMPLETED' || payment.status === 'PAID') return payment
  if (payment.status === 'FAILED') throw new AppError('payment_already_failed', 400)

  const [updated] = await prisma.$transaction([
    prisma.payment.update({
      where: { id: paymentId },
      data: {
        status: 'COMPLETED',
        gatewayTxId,
        gatewayResponse: gatewayResponse ?? undefined,
        paidAt: new Date(),
      },
    }),
    prisma.booking.update({
      where: { id: payment.bookingId },
      data: { paymentStatus: 'PAID' },
    }),
  ])
  return updated
}

export async function failPayment(paymentId: string, reason?: string) {
  const payment = await prisma.payment.findUnique({
    where: { id: paymentId },
    include: { booking: { select: { customerId: true } } },
  })
  if (!payment) throw new AppError('not_found', 404)
  if (payment.status === 'COMPLETED') throw new AppError('payment_already_completed', 400)

  const updated = await prisma.payment.update({
    where: { id: paymentId },
    data: {
      status: 'FAILED',
      ...(reason ? { gatewayResponse: { reason } as Prisma.InputJsonValue } : {}),
    },
  })

  createNotification(
    payment.booking.customerId, 'SYSTEM_ALERT',
    'Payment Failed', 'فشل الدفع',
    reason ?? 'Your payment could not be processed. Please try again.',
    reason ?? 'لم نتمكن من معالجة الدفعة. يرجى المحاولة مرة أخرى.',
    { bookingId: payment.bookingId },
  ).catch(() => {})

  return updated
}

// PA-3: Cash — immediately COMPLETED, reliability guard ≥ 80
export async function initiateCashPayment(userId: string, bookingId: string) {
  const [reliability, booking] = await Promise.all([
    prisma.reliabilityRecord.findUnique({ where: { userId } }),
    prisma.booking.findUnique({
      where: { id: bookingId },
      select: { id: true, customerId: true, totalPrice: true, depositPaid: true, paymentStatus: true, payment: true },
    }),
  ])

  if ((reliability?.score ?? 100) < 80) throw new AppError('reliability_too_low', 403)
  if (!booking) throw new AppError('not_found', 404)
  if (booking.customerId !== userId) throw new AppError('forbidden', 403)

  // Idempotency: payment already completed
  if (booking.payment?.status === 'COMPLETED') return booking.payment
  if (booking.paymentStatus === 'PAID' && booking.payment) return booking.payment

  const key = `CASH-${bookingId}`
  const existing = await prisma.payment.findUnique({ where: { idempotencyKey: key } })
  if (existing) return existing

  const [payment] = await prisma.$transaction([
    prisma.payment.create({
      data: {
        bookingId,
        provider: 'CASH',
        status: 'COMPLETED',
        amount: booking.totalPrice,
        depositAmount: booking.depositPaid,
        remainingAmount: booking.totalPrice - booking.depositPaid,
        idempotencyKey: key,
        paidAt: new Date(),
      },
    }),
    prisma.booking.update({
      where: { id: bookingId },
      data: { paymentStatus: 'PAID' },
    }),
  ])
  return payment
}
