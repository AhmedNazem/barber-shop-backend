import { prisma } from '@/config/prisma'
import { AppError } from '@/lib/errors'
import { NotificationType } from '@prisma/client'
import { sendPush } from '@/lib/web-push'

export async function createNotification(
  userId: string,
  type: NotificationType,
  title: string,
  titleAr: string,
  message: string,
  messageAr: string,
  meta?: { bookingId?: string; reviewId?: string },
) {
  const notification = await prisma.notification.create({
    data: { userId, type, title, titleAr, message, messageAr, bookingId: meta?.bookingId, reviewId: meta?.reviewId },
  })

  // Fire push notifications to all user's subscriptions (non-blocking)
  const subs = await prisma.pushSubscription.findMany({ where: { userId } })
  const results = await Promise.all(subs.map(s => sendPush(s, { title, body: message })))
  const expiredIds = subs.filter((_, i) => results[i] === 'expired').map(s => s.id)
  if (expiredIds.length) {
    await prisma.pushSubscription.deleteMany({ where: { id: { in: expiredIds } } })
  }

  return notification
}

export async function storePushSubscription(
  userId: string,
  endpoint: string,
  p256dh: string,
  auth: string,
) {
  await prisma.pushSubscription.upsert({
    where:  { endpoint },
    update: { userId, p256dh, auth },
    create: { userId, endpoint, p256dh, auth },
  })
}

export async function removePushSubscription(endpoint: string) {
  await prisma.pushSubscription.deleteMany({ where: { endpoint } })
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
