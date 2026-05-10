import { prisma } from '@/config/prisma'
import { AppError } from '@/lib/errors'
import { createNotification } from '@/services/notification.service'

export async function submitPaymentProof(
  bookingId: string,
  customerId: string,
  referenceNote: string,
) {
  const booking = await prisma.booking.findUnique({
    where: { id: bookingId },
  })
  if (!booking) throw new AppError('not_found', 404)
  if (booking.customerId !== customerId) throw new AppError('forbidden', 403)
  if (!['ZAINCASH', 'FIB'].includes(booking.paymentMethod))
    throw new AppError('method_not_manual', 422)
  if (booking.paymentStatus !== 'PENDING')
    throw new AppError('payment_already_submitted', 409)

  await prisma.$transaction([
    prisma.manualPaymentProof.create({
      data: { bookingId, referenceNote },
    }),
    prisma.booking.update({
      where: { id: bookingId },
      data: { paymentStatus: 'AWAITING_CONFIRMATION' },
    }),
  ])
}

export async function confirmPayment(bookingId: string, adminId: string) {
  const booking = await prisma.booking.findUnique({
    where: { id: bookingId },
    include: { paymentProof: true },
  })
  if (!booking) throw new AppError('not_found', 404)
  if (booking.paymentStatus !== 'AWAITING_CONFIRMATION')
    throw new AppError('not_awaiting', 422)

  await prisma.$transaction([
    prisma.booking.update({
      where: { id: bookingId },
      data: { paymentStatus: 'PAID', status: 'CONFIRMED' },
    }),
    prisma.manualPaymentProof.update({
      where: { bookingId },
      data: { reviewedAt: new Date(), reviewedBy: adminId },
    }),
  ])

  await createNotification(
    booking.customerId,
    'PAYMENT_RECEIVED',
    'Payment Confirmed',
    'تم تأكيد الدفع',
    'Your payment has been confirmed. Your booking is now confirmed.',
    'تم تأكيد دفعتك. حجزك مؤكد الآن.',
    { bookingId },
  )
}

export async function rejectPayment(
  bookingId: string,
  adminId: string,
  reason: string,
) {
  const booking = await prisma.booking.findUnique({
    where: { id: bookingId },
  })
  if (!booking) throw new AppError('not_found', 404)
  if (booking.paymentStatus !== 'AWAITING_CONFIRMATION')
    throw new AppError('not_awaiting', 422)

  await prisma.$transaction([
    prisma.booking.update({
      where: { id: bookingId },
      data: { paymentStatus: 'FAILED' },
    }),
    prisma.manualPaymentProof.update({
      where: { bookingId },
      data: { reviewedAt: new Date(), reviewedBy: adminId, rejectReason: reason },
    }),
  ])

  await createNotification(
    booking.customerId,
    'PAYMENT_RECEIVED',
    'Payment Not Confirmed',
    'لم يتم تأكيد الدفع',
    `Your payment could not be confirmed. Reason: ${reason}`,
    `لم نتمكن من تأكيد دفعتك. السبب: ${reason}`,
    { bookingId },
  )
}

export async function listPendingPayments() {
  return prisma.booking.findMany({
    where: { paymentStatus: 'AWAITING_CONFIRMATION' },
    include: {
      shop:        { select: { id: true, nameEn: true, nameAr: true } },
      services:    { select: { nameEn: true, price: true } },
      paymentProof: true,
    },
    orderBy: { updatedAt: 'asc' },
  })
}
