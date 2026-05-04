import { prisma } from '@/config/prisma'
import { AppError } from '@/lib/errors'
import { createNotification } from '@/services/notification.service'
import { UserRole } from '@prisma/client'

// Role transitions blocked per §1b
const BLOCKED_FROM: Partial<Record<UserRole, UserRole[]>> = {
  CUSTOMER: [UserRole.BARBER, UserRole.SHOP_OWNER],
  BARBER:   [UserRole.SHOP_OWNER],
}

// ─── Shop management ──────────────────────────────────────────────────────────

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

// ─── User management ──────────────────────────────────────────────────────────

export async function listUsers(opts: { role?: string; page: number; limit: number }) {
  const where = {
    deletedAt: null,
    ...(opts.role ? { role: opts.role as UserRole } : {}),
  }
  const [users, total] = await Promise.all([
    prisma.user.findMany({
      where,
      select: { id: true, phone: true, name: true, role: true, shopId: true, suspended: true, createdAt: true },
      orderBy: { createdAt: 'desc' },
      skip:    (opts.page - 1) * opts.limit,
      take:    opts.limit,
    }),
    prisma.user.count({ where }),
  ])
  return { users, total, page: opts.page, limit: opts.limit }
}

export async function getUser(userId: string) {
  const user = await prisma.user.findFirst({
    where:  { id: userId, deletedAt: null },
    select: { id: true, phone: true, name: true, role: true, shopId: true, suspended: true, isVip: true, createdAt: true },
  })
  if (!user) throw new AppError('not_found', 404)
  return user
}

export async function changeUserRole(userId: string, newRole: string) {
  const user = await prisma.user.findFirst({ where: { id: userId, deletedAt: null } })
  if (!user) throw new AppError('not_found', 404)

  if (newRole === 'ADMIN') throw new AppError('role_change_not_allowed', 403)
  const blocked = BLOCKED_FROM[user.role] ?? []
  if (blocked.includes(newRole as UserRole)) throw new AppError('role_change_not_allowed', 403)

  await prisma.$transaction(async (tx) => {
    await tx.user.update({ where: { id: userId }, data: { role: newRole as UserRole } })
    await tx.refreshToken.deleteMany({ where: { userId } })
  })
}

export async function suspendUser(userId: string) {
  const user = await prisma.user.findFirst({ where: { id: userId, deletedAt: null } })
  if (!user) throw new AppError('not_found', 404)
  await prisma.user.update({ where: { id: userId }, data: { suspended: true } })
}

export async function deleteUser(userId: string) {
  const user = await prisma.user.findFirst({ where: { id: userId, deletedAt: null } })
  if (!user) throw new AppError('not_found', 404)

  await prisma.$transaction(async (tx) => {
    await tx.user.update({
      where: { id: userId },
      data:  { deletedAt: new Date(), phone: `deleted_${userId}`, name: 'Deleted User' },
    })
    await tx.refreshToken.deleteMany({ where: { userId } })
  })
}

// ─── Shop suspension preview ──────────────────────────────────────────────────

export async function getSuspendPreview(shopId: string) {
  const shop = await prisma.shop.findUnique({ where: { id: shopId } })
  if (!shop) throw new AppError('not_found', 404)

  const [bookings, agg] = await Promise.all([
    prisma.booking.count({ where: { shopId, status: 'UPCOMING' } }),
    prisma.booking.aggregate({
      where: { shopId, status: 'UPCOMING' },
      _sum:  { depositPaid: true },
    }),
  ])

  return { activeBookings: bookings, pendingDepositsIQD: agg._sum.depositPaid ?? 0 }
}
