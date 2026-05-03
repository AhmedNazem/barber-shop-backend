import { prisma } from '@/config/prisma'
import { AppError } from '@/lib/errors'
import { NotificationType } from '@prisma/client'

export async function createNotification(
  userId: string,
  type: NotificationType,
  title: string,
  titleAr: string,
  message: string,
  messageAr: string,
  meta?: { bookingId?: string; reviewId?: string },
) {
  return prisma.notification.create({
    data: { userId, type, title, titleAr, message, messageAr, bookingId: meta?.bookingId, reviewId: meta?.reviewId },
  })
}

export async function getNotifications(userId: string) {
  const notifications = await prisma.notification.findMany({
    where:   { userId },
    orderBy: { createdAt: 'desc' },
    take:    50,
  })
  const unreadCount = notifications.filter(n => !n.isRead).length
  return { notifications, unreadCount }
}

export async function markNotificationRead(notificationId: string, userId: string) {
  const n = await prisma.notification.findUnique({ where: { id: notificationId } })
  if (!n || n.userId !== userId) throw new AppError('not_found', 404)
  await prisma.notification.update({ where: { id: notificationId }, data: { isRead: true } })
}

export async function markAllRead(userId: string) {
  await prisma.notification.updateMany({ where: { userId, isRead: false }, data: { isRead: true } })
}
