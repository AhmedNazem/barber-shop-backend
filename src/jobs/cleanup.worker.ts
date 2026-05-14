import { Worker, Job } from 'bullmq'
import { redisClient } from '@/lib/redis'
import { cleanupQueue } from '@/lib/queue'
import { prisma } from '@/config/prisma'
import { expireOldPoints } from '@/services/loyalty.service'
import { createNotification } from '@/services/notification.service'

type CleanupJobName = 'otp-cleanup' | 'refresh-token-cleanup' | 'invite-cleanup' | 'loyalty-expiry' | 'payment-expiry'

async function processJob(job: Job) {
  const name = job.name as CleanupJobName

  // Distributed lock — prevents double-run if two server instances are active simultaneously
  const lockKey = `lock:cleanup:${name}`
  const acquired = await redisClient.set(lockKey, '1', 'EX', 60, 'NX')
  if (!acquired) {
    console.log(`[cleanup] ${name} already running on another instance — skipping`)
    return
  }

  try {
    if (name === 'otp-cleanup') {
      const { count } = await prisma.otpCode.deleteMany({
        where: { expiresAt: { lt: new Date() } },
      })
      console.log(`[cleanup] deleted ${count} expired OTP codes`)

    } else if (name === 'refresh-token-cleanup') {
      const { count } = await prisma.refreshToken.deleteMany({
        where: { expiresAt: { lt: new Date() } },
      })
      console.log(`[cleanup] deleted ${count} expired refresh tokens`)

    } else if (name === 'invite-cleanup') {
      const { count } = await prisma.inviteCode.deleteMany({
        where: { expiresAt: { lt: new Date() }, usedAt: null },
      })
      console.log(`[cleanup] deleted ${count} expired unused invite codes`)

    } else if (name === 'loyalty-expiry') {
      const count = await expireOldPoints()
      console.log(`[cleanup] expired loyalty points for ${count} users`)

    } else if (name === 'payment-expiry') {
      const expired = await prisma.payment.findMany({
        where: { status: 'PENDING', expiresAt: { lt: new Date() } },
        select: { id: true, bookingId: true },
      })

      if (expired.length) {
        const paymentIds = expired.map(p => p.id)
        const bookingIds = expired.map(p => p.bookingId)

        const bookings = await prisma.booking.findMany({
          where: { id: { in: bookingIds } },
          select: { id: true, customerId: true },
        })

        await prisma.$transaction([
          prisma.payment.updateMany({ where: { id: { in: paymentIds } }, data: { status: 'FAILED' } }),
          prisma.booking.updateMany({ where: { id: { in: bookingIds } }, data: { status: 'CANCELLED', cancellationReason: 'payment_expired' } }),
        ])

        await Promise.all(
          bookings.map(b =>
            createNotification(
              b.customerId, 'SYSTEM_ALERT',
              'Payment Expired', 'انتهت مهلة الدفع',
              'Your checkout session expired. The booking was cancelled and the slot is now free.',
              'انتهت مهلة إتمام الدفع وتم إلغاء الحجز. الموعد متاح الآن للحجز من جديد.',
              { bookingId: b.id },
            ).catch(() => {}),
          ),
        )

        console.log(`[cleanup] expired ${expired.length} pending payments, cancelled bookings`)
      }

    } else {
      console.warn(`[cleanup] unknown job name: ${name}`)
    }
  } finally {
    await redisClient.del(lockKey)
  }
}

export async function startCleanupWorker() {
  await cleanupQueue.add('otp-cleanup',           {}, { repeat: { every: 10 * 60 * 1000 } })
  await cleanupQueue.add('refresh-token-cleanup', {}, { repeat: { every: 60 * 60 * 1000 } })
  await cleanupQueue.add('invite-cleanup',        {}, { repeat: { every: 60 * 60 * 1000 } })
  await cleanupQueue.add('loyalty-expiry',        {}, { repeat: { every: 24 * 60 * 60 * 1000 } })
  await cleanupQueue.add('payment-expiry',        {}, { repeat: { every: 5 * 60 * 1000 } })

  const worker = new Worker('cleanup', processJob, { connection: redisClient, concurrency: 1 })

  worker.on('completed', (job) => console.log(`[cleanup] ${job.name}#${job.id} done`))
  worker.on('failed',    (job, err) => console.error(`[cleanup] ${job?.name}#${job?.id} failed after ${job?.attemptsMade} attempts:`, err.message))
  worker.on('error',     (err) => console.error('[cleanup] worker error:', err.message))

  return worker
}
