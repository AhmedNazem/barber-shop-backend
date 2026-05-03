import { prisma } from '@/config/prisma'
import { AppError } from '@/lib/errors'
import { FlagReason } from '@prisma/client'
import { createNotification } from '@/services/notification.service'

export async function listShopReviews(shopId: string, asOwner: boolean, page: number, limit: number) {
  const where = asOwner ? { shopId } : { shopId, isVisible: true }
  const [reviews, total] = await Promise.all([
    prisma.review.findMany({
      where,
      include: { photos: true },
      orderBy: { createdAt: 'desc' },
      skip:    (page - 1) * limit,
      take:    limit,
    }),
    prisma.review.count({ where }),
  ])

  const customerIds = [...new Set(reviews.map(r => r.customerId))]
  const customers = await prisma.user.findMany({
    where: { id: { in: customerIds } }, select: { id: true, name: true },
  })
  const nameMap = Object.fromEntries(customers.map(c => [c.id, c.name]))

  return {
    reviews: reviews.map(r => ({
      id:           r.id,
      author:       nameMap[r.customerId] ?? 'Unknown',
      rating:       r.rating,
      comment:      r.comment,
      photos:       r.photos.map(p => p.url),
      isVisible:    r.isVisible,
      flagStatus:   r.flagStatus,
      createdAt:    r.createdAt,
    })),
    total,
  }
}

export async function createReview(
  customerId: string,
  data: { bookingId: string; rating: number; comment: string; barberId?: string; photoUrls?: string[] },
) {
  const booking = await prisma.booking.findUnique({ where: { id: data.bookingId } })
  if (!booking) throw new AppError('not_found', 404)
  if (booking.customerId !== customerId) throw new AppError('forbidden', 403)
  if (booking.hasReview) throw new AppError('already_reviewed', 409)

  return prisma.$transaction(async (tx) => {
    const review = await tx.review.create({
      data: {
        bookingId:  data.bookingId,
        customerId,
        shopId:     booking.shopId,
        barberId:   data.barberId,
        rating:     data.rating,
        comment:    data.comment,
        photos:     data.photoUrls?.length
          ? { create: data.photoUrls.map(url => ({ url })) }
          : undefined,
      },
      include: { photos: true },
    })
    await tx.booking.update({ where: { id: data.bookingId }, data: { hasReview: true } })
    return review
  })
}

export async function flagReview(reviewId: string, ownerId: string, reason: FlagReason) {
  const review = await prisma.review.findUnique({ where: { id: reviewId } })
  if (!review) throw new AppError('not_found', 404)

  const shop = await prisma.shop.findUnique({ where: { id: review.shopId } })
  if (!shop || shop.ownerId !== ownerId) throw new AppError('forbidden', 403)

  return prisma.review.update({
    where: { id: reviewId },
    data:  { flagStatus: 'PENDING', flagReason: reason, flaggedBy: ownerId, flaggedAt: new Date() },
  })
}

export async function resolveFlag(
  reviewId: string,
  action: 'approve' | 'remove',
  removalReason?: string,
) {
  const review = await prisma.review.findUnique({ where: { id: reviewId } })
  if (!review) throw new AppError('not_found', 404)
  if (review.flagStatus !== 'PENDING') throw new AppError('not_found', 404)

  const updated = await prisma.review.update({
    where: { id: reviewId },
    data: {
      flagStatus:    action === 'approve' ? 'APPROVED' : 'REMOVED',
      isVisible:     action !== 'remove',
      removalReason: action === 'remove' ? removalReason : undefined,
      resolvedAt:    new Date(),
    },
  })

  if (action === 'remove') {
    const shop = await prisma.shop.findUnique({ where: { id: review.shopId }, select: { ownerId: true } })
    if (shop) {
      await createNotification(
        shop.ownerId, 'SYSTEM_ALERT',
        'Review Removed', 'تم حذف التقييم',
        'A flagged review on your shop has been removed.', 'تم حذف تقييم مُبلَّغ عنه في متجرك.',
        { reviewId },
      )
    }
  }

  return updated
}
