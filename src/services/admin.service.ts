import { prisma } from '@/config/prisma'
import { AppError } from '@/lib/errors'
import { createNotification } from '@/services/notification.service'

export async function approveShop(shopId: string) {
  const shop = await prisma.shop.findUnique({ where: { id: shopId } })
  if (!shop) throw new AppError('not_found', 404)

  await prisma.shop.update({
    where: { id: shopId },
    data: { status: 'APPROVED', isActive: true },
  })

  await createNotification(
    shop.ownerId, 'SYSTEM_ALERT',
    'Shop Approved', 'تمت الموافقة على محلك',
    'Your shop has been approved and is now live!',
    'تمت الموافقة على محلك وهو الآن نشط.',
  )
}

export async function rejectShop(shopId: string, reason: string, reasonAr: string) {
  const shop = await prisma.shop.findUnique({ where: { id: shopId } })
  if (!shop) throw new AppError('not_found', 404)

  await prisma.shop.update({
    where: { id: shopId },
    data: { status: 'REJECTED', rejectionReason: reason, rejectionReasonAr: reasonAr },
  })

  await createNotification(
    shop.ownerId, 'SYSTEM_ALERT',
    'Shop Application Rejected', 'تم رفض طلب محلك',
    `Your shop application was rejected. Reason: ${reason}`,
    `تم رفض طلب محلك. السبب: ${reasonAr}`,
  )
}

export async function suspendShop(shopId: string, reason: string) {
  const shop = await prisma.shop.findUnique({
    where:  { id: shopId },
    select: { id: true, ownerId: true, nameEn: true, nameAr: true },
  })
  if (!shop) throw new AppError('not_found', 404)

  // Fetch upcoming bookings before the transaction so we can notify customers after
  const upcomingBookings = await prisma.booking.findMany({
    where:  { shopId, status: 'UPCOMING' },
    select: { id: true, customerId: true },
  })

  await prisma.$transaction(async (tx) => {
    await tx.shop.update({
      where: { id: shopId },
      data:  { status: 'SUSPENDED', isActive: false, suspendReason: reason, suspendedAt: new Date() },
    })

    if (upcomingBookings.length) {
      await tx.booking.updateMany({
        where: { shopId, status: 'UPCOMING' },
        data:  { status: 'CANCELLED', cancelledBy: 'admin', cancellationReason: 'shop_suspended' },
      })
    }
  })

  // Notify customers and owner outside the transaction (fire-and-forget; not worth aborting the suspension if one fails)
  await Promise.all([
    ...upcomingBookings.map(b =>
      createNotification(
        b.customerId, 'CANCELLATION',
        'Booking Cancelled', 'تم إلغاء الحجز',
        'Your booking was cancelled because the shop has been suspended.',
        'تم إلغاء حجزك بسبب تعليق المحل.',
        { bookingId: b.id },
      ),
    ),
    createNotification(
      shop.ownerId, 'SYSTEM_ALERT',
      'Shop Suspended', 'تم تعليق محلك',
      `Your shop has been suspended. Reason: ${reason}`,
      `تم تعليق محلك. السبب: ${reason}`,
    ),
  ])
}
