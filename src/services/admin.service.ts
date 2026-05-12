import { prisma } from '@/config/prisma'
import { AppError } from '@/lib/errors'
import { createNotification } from '@/services/notification.service'
import { UserRole, BookingStatus } from '@prisma/client'

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

  if (shop.ownerId) {
    await createNotification(
      shop.ownerId, 'SYSTEM_ALERT',
      'Shop Approved', 'تمت الموافقة على محلك',
      'Your shop has been approved and is now live!',
      'تمت الموافقة على محلك وهو الآن نشط.',
    )
  }
}

export async function rejectShop(shopId: string, reason: string, reasonAr: string) {
  const shop = await prisma.shop.findUnique({ where: { id: shopId } })
  if (!shop) throw new AppError('not_found', 404)

  await prisma.shop.update({
    where: { id: shopId },
    data: { status: 'REJECTED', rejectionReason: reason, rejectionReasonAr: reasonAr },
  })

  if (shop.ownerId) {
    await createNotification(
      shop.ownerId, 'SYSTEM_ALERT',
      'Shop Application Rejected', 'تم رفض طلب محلك',
      `Your shop application was rejected. Reason: ${reason}`,
      `تم رفض طلب محلك. السبب: ${reasonAr}`,
    )
  }
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
  const ownerNotif = shop.ownerId
    ? [createNotification(
        shop.ownerId, 'SYSTEM_ALERT',
        'Shop Suspended', 'تم تعليق محلك',
        `Your shop has been suspended. Reason: ${reason}`,
        `تم تعليق محلك. السبب: ${reason}`,
      )]
    : []

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
    ...ownerNotif,
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

// ─── All users list (admin management) ───────────────────────────────────────

const ROLE_DISPLAY: Record<string, 'customer' | 'barber' | 'shop_owner'> = {
  CUSTOMER: 'customer', BARBER: 'barber', SHOP_OWNER: 'shop_owner',
}
const ROLE_FILTER: Record<string, string> = {
  customer: 'CUSTOMER', barber: 'BARBER', shop_owner: 'SHOP_OWNER',
}

export async function listAllUsers(opts: { role?: string; search?: string; page: number; limit: number }) {
  const where = {
    deletedAt: null,
    ...(opts.role && ROLE_FILTER[opts.role] ? { role: ROLE_FILTER[opts.role] as UserRole } : {}),
    ...(opts.search ? {
      OR: [
        { name:  { contains: opts.search, mode: 'insensitive' as const } },
        { phone: { contains: opts.search } },
      ],
    } : {}),
  }

  const [users, total] = await Promise.all([
    prisma.user.findMany({
      where,
      select: {
        id: true, name: true, phone: true, role: true, shopId: true,
        suspended: true, createdAt: true, updatedAt: true,
        reliabilityRecord: { select: { noShowCount: true } },
      },
      orderBy: { createdAt: 'desc' },
      skip: (opts.page - 1) * opts.limit,
      take: opts.limit,
    }),
    prisma.user.count({ where }),
  ])

  if (users.length === 0) return { users: [], total: 0, page: opts.page, limit: opts.limit }

  const userIds  = users.map((u) => u.id)
  const shopIds  = users.map((u) => u.shopId).filter((id): id is string => id !== null)
  const ownerIds = users.filter((u) => u.role === 'SHOP_OWNER').map((u) => u.id)

  const [bookingGroups, shopsByBarber, shopsByOwner] = await Promise.all([
    prisma.booking.groupBy({
      by: ['customerId', 'status'],
      where: { customerId: { in: userIds } },
      _count: { _all: true },
      _sum:   { totalPrice: true },
    }),
    shopIds.length  ? prisma.shop.findMany({ where: { id:      { in: shopIds  } }, select: { id: true, nameEn: true, status: true } }) : Promise.resolve([]),
    ownerIds.length ? prisma.shop.findMany({ where: { ownerId: { in: ownerIds } }, select: { ownerId: true, nameEn: true, status: true } }) : Promise.resolve([]),
  ])

  type BG = (typeof bookingGroups)[0]
  const bookingMap   = new Map<string, BG[]>()
  for (const g of bookingGroups) {
    const arr = bookingMap.get(g.customerId) ?? []
    arr.push(g)
    bookingMap.set(g.customerId, arr)
  }
  const shopByIdMap    = new Map(shopsByBarber.map((s) => [s.id, s]))
  const shopByOwnerMap = new Map(shopsByOwner.map((s) => [s.ownerId!, s]))

  const result = users.map((user) => {
    const groups = bookingMap.get(user.id) ?? []
    const completed = groups.find((g) => g.status === 'COMPLETED')
    const linkedShop = user.role === 'SHOP_OWNER'
      ? shopByOwnerMap.get(user.id)
      : user.shopId ? shopByIdMap.get(user.shopId) : null

    const noShows = user.reliabilityRecord?.noShowCount ?? 0
    const flags: string[] = Array.from({ length: Math.min(noShows, 3) }, () => 'no_show')
    if (linkedShop?.status === 'SUSPENDED') flags.push('shop_suspended')

    return {
      id:             user.id,
      name:           user.name,
      phone:          user.phone,
      role:           ROLE_DISPLAY[user.role] ?? 'customer',
      status:         user.suspended ? 'suspended' : 'active',
      joinedAt:       user.createdAt.toISOString().slice(0, 10),
      lastActive:     user.updatedAt.toISOString().slice(0, 10),
      bookingCount:   groups.reduce((n, g) => n + g._count._all, 0),
      totalSpentIQD:  completed?._sum.totalPrice ?? 0,
      linkedShopName: linkedShop?.nameEn,
      flags,
    }
  })

  return { users: result, total, page: opts.page, limit: opts.limit }
}

// ─── All shops list (admin management) ───────────────────────────────────────

const DISPLAY_STATUS: Record<string, 'active' | 'pending' | 'suspended'> = {
  APPROVED: 'active', PENDING: 'pending', REJECTED: 'pending', SUSPENDED: 'suspended',
}
const FILTER_STATUS: Record<string, string> = {
  active: 'APPROVED', pending: 'PENDING', suspended: 'SUSPENDED',
}

export async function listAllShops(opts: { status?: string; search?: string; page: number; limit: number }) {
  const statusFilter = opts.status ? FILTER_STATUS[opts.status] : undefined
  const where = {
    ...(statusFilter ? { status: statusFilter as 'APPROVED' | 'PENDING' | 'SUSPENDED' } : {}),
    ...(opts.search ? {
      OR: [
        { nameEn: { contains: opts.search, mode: 'insensitive' as const } },
        { nameAr: { contains: opts.search } },
        { city:   { contains: opts.search, mode: 'insensitive' as const } },
      ],
    } : {}),
  }

  const [shops, total] = await Promise.all([
    prisma.shop.findMany({
      where,
      select: {
        id: true, nameEn: true, nameAr: true, city: true, status: true,
        ownerId: true, createdAt: true, suspendedAt: true, suspendReason: true,
        _count: { select: { services: true } },
      },
      orderBy: { createdAt: 'desc' },
      skip: (opts.page - 1) * opts.limit,
      take: opts.limit,
    }),
    prisma.shop.count({ where }),
  ])

  if (shops.length === 0) return { shops: [], total: 0, page: opts.page, limit: opts.limit }

  const shopIds   = shops.map((s) => s.id)
  const ownerIds  = shops.map((s) => s.ownerId).filter((id): id is string => id !== null)
  const monthStart = new Date(new Date().getFullYear(), new Date().getMonth(), 1)

  const [owners, bookingGroups, monthlyRevGroups, ratingGroups] = await Promise.all([
    prisma.user.findMany({ where: { id: { in: ownerIds } }, select: { id: true, name: true, phone: true } }),
    prisma.booking.groupBy({
      by: ['shopId', 'status'],
      where: { shopId: { in: shopIds } },
      _count: { _all: true },
      _sum:   { depositPaid: true },
    }),
    prisma.booking.groupBy({
      by: ['shopId'],
      where: { shopId: { in: shopIds }, status: 'COMPLETED', slot: { gte: monthStart } },
      _sum: { totalPrice: true },
    }),
    prisma.review.groupBy({
      by: ['shopId'],
      where: { shopId: { in: shopIds } },
      _avg: { rating: true },
    }),
  ])

  const ownerMap     = new Map(owners.map((o) => [o.id, o]))
  const monthRevMap  = new Map(monthlyRevGroups.map((g) => [g.shopId, g._sum.totalPrice ?? 0]))
  const ratingMap    = new Map(ratingGroups.map((g) => [g.shopId, Math.round((g._avg.rating ?? 0) * 10) / 10]))

  type BG = (typeof bookingGroups)[0]
  const bookingMap = new Map<string, BG[]>()
  for (const g of bookingGroups) {
    const arr = bookingMap.get(g.shopId) ?? []
    arr.push(g)
    bookingMap.set(g.shopId, arr)
  }

  const result = shops.map((shop) => {
    const owner  = shop.ownerId ? ownerMap.get(shop.ownerId) : null
    const stats  = bookingMap.get(shop.id) ?? []
    const byStatus = (s: string) => stats.find((g) => g.status === s)

    return {
      id: shop.id, nameEn: shop.nameEn, nameAr: shop.nameAr, city: shop.city,
      status: DISPLAY_STATUS[shop.status] ?? 'pending' as 'active' | 'pending' | 'suspended',
      ownerName:  owner?.name  ?? '—',
      ownerPhone: owner?.phone ?? '—',
      rating:         ratingMap.get(shop.id) ?? 0,
      totalBookings:  stats.reduce((n, g) => n + g._count._all, 0),
      servicesCount:  shop._count.services,
      monthlyRevenue: monthRevMap.get(shop.id) ?? 0,
      joinedAt: shop.createdAt.toISOString().slice(0, 10),
      suspensionHistory: shop.suspendedAt && shop.suspendReason
        ? [{ date: shop.suspendedAt.toISOString().slice(0, 10), reason: shop.suspendReason }]
        : [],
      activeBookings:   byStatus('CONFIRMED')?._count._all ?? 0,
      pendingBookings:  byStatus('UPCOMING')?._count._all  ?? 0,
      pendingDepositsIQD: byStatus('UPCOMING')?._sum.depositPaid ?? 0,
    }
  })

  return { shops: result, total, page: opts.page, limit: opts.limit }
}

// ─── Booking management ───────────────────────────────────────────────────────

const BOOKING_STATUS_DISPLAY: Record<string, 'pending' | 'confirmed' | 'completed' | 'cancelled'> = {
  UPCOMING: 'pending', CONFIRMED: 'confirmed', COMPLETED: 'completed',
  CANCELLED: 'cancelled', NO_SHOW: 'cancelled',
}
const BOOKING_STATUS_FILTER: Record<string, string[]> = {
  pending: ['UPCOMING'], confirmed: ['CONFIRMED'], completed: ['COMPLETED'],
  cancelled: ['CANCELLED', 'NO_SHOW'],
}
const PAYMENT_DISPLAY: Record<string, 'unpaid' | 'deposit_paid' | 'fully_paid' | 'refunded'> = {
  PENDING: 'unpaid', AWAITING_CONFIRMATION: 'deposit_paid',
  PAID: 'fully_paid', REFUNDED: 'refunded', FAILED: 'unpaid',
}

function fmtBaghdad(d: Date): string {
  const local = new Date(d.getTime() + 3 * 3_600_000)
  return local.toISOString().slice(0, 16).replace('T', ' ')
}

export async function listAllBookings(opts: { status?: string; shopId?: string; search?: string; page: number; limit: number }) {
  const statusIn = opts.status ? BOOKING_STATUS_FILTER[opts.status] : undefined

  let searchCustomerIds: string[] | undefined
  if (opts.search) {
    const matches = await prisma.user.findMany({
      where: { name: { contains: opts.search, mode: 'insensitive' } },
      select: { id: true },
    })
    searchCustomerIds = matches.map((u) => u.id)
  }

  const where = {
    ...(statusIn ? { status: { in: statusIn as BookingStatus[] } } : {}),
    ...(opts.shopId && opts.shopId !== 'all' ? { shopId: opts.shopId } : {}),
    ...(opts.search ? {
      OR: [
        { id: { contains: opts.search, mode: 'insensitive' } },
        { shop: { nameEn: { contains: opts.search, mode: 'insensitive' } } },
        ...(searchCustomerIds?.length ? [{ customerId: { in: searchCustomerIds } }] : []),
      ],
    } : {}),
  }

  const [bookings, total] = await Promise.all([
    prisma.booking.findMany({
      where,
      select: {
        id: true, customerId: true, shopId: true, barberName: true,
        slot: true, status: true, totalPrice: true, depositPaid: true,
        paymentStatus: true, cancelledBy: true, cancellationReason: true,
        shop:     { select: { nameEn: true } },
        services: { select: { nameEn: true }, orderBy: { price: 'desc' }, take: 1 },
        review:   { select: { flagStatus: true, comment: true } },
      },
      orderBy: { slot: 'desc' },
      skip: (opts.page - 1) * opts.limit,
      take: opts.limit,
    }),
    prisma.booking.count({ where }),
  ])

  if (bookings.length === 0) return { bookings: [], total: 0, page: opts.page, limit: opts.limit }

  const custIds   = [...new Set(bookings.map((b) => b.customerId))]
  const customers = await prisma.user.findMany({
    where: { id: { in: custIds } },
    select: { id: true, name: true },
  })
  const custMap = new Map(customers.map((c) => [c.id, c.name]))

  const result = bookings.map((b) => {
    const disputeFlag = b.review?.flagStatus === 'PENDING'
    return {
      id: b.id,
      customerId: b.customerId,
      customerName: custMap.get(b.customerId) ?? '—',
      shopId: b.shopId,
      shopName: b.shop.nameEn,
      serviceName: b.services[0]?.nameEn ?? '—',
      barberName: b.barberName ?? '—',
      dateTime: fmtBaghdad(b.slot),
      status: BOOKING_STATUS_DISPLAY[b.status] ?? 'pending',
      paymentStatus: PAYMENT_DISPLAY[b.paymentStatus] ?? 'unpaid',
      totalIQD: b.totalPrice,
      depositIQD: b.depositPaid,
      cancelledBy: b.cancelledBy as 'customer' | 'shop' | 'admin' | undefined,
      cancellationReason: b.cancellationReason ?? undefined,
      disputeFlag,
      disputeReason: disputeFlag ? b.review?.comment : undefined,
    }
  })

  return { bookings: result, total, page: opts.page, limit: opts.limit }
}

export async function forceCancelBooking(bookingId: string, reason: string) {
  const booking = await prisma.booking.findUnique({
    where: { id: bookingId },
    select: { id: true, customerId: true, paymentStatus: true, status: true },
  })
  if (!booking) throw new AppError('not_found', 404)
  if (booking.status === 'CANCELLED' || booking.status === 'COMPLETED') {
    throw new AppError('invalid_state', 400)
  }

  await prisma.booking.update({
    where: { id: bookingId },
    data: {
      status: 'CANCELLED',
      cancelledBy: 'admin',
      cancellationReason: reason,
      ...(booking.paymentStatus === 'PAID' ? { paymentStatus: 'REFUNDED' } : {}),
    },
  })

  await createNotification(
    booking.customerId, 'CANCELLATION',
    'Booking Cancelled', 'تم إلغاء الحجز',
    `Your booking was cancelled by admin. Reason: ${reason}`,
    `تم إلغاء حجزك من قبل الإدارة. السبب: ${reason}`,
    { bookingId },
  )
}

// ─── Pending shops (Google Maps imports) ─────────────────────────────────────

export async function listPendingShops(opts: { page: number; limit: number }) {
  const [shops, total] = await Promise.all([
    prisma.shop.findMany({
      where:   { status: 'PENDING' },
      select:  { id: true, nameEn: true, nameAr: true, city: true, address: true, placeId: true, createdAt: true },
      orderBy: { createdAt: 'asc' },
      skip:    (opts.page - 1) * opts.limit,
      take:    opts.limit,
    }),
    prisma.shop.count({ where: { status: 'PENDING' } }),
  ])
  return { shops, total, page: opts.page, limit: opts.limit }
}
