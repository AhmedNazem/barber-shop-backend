import { Worker, Job } from 'bullmq'
import { redisClient } from '@/lib/redis'
import { cleanupQueue } from '@/lib/queue'
import { prisma } from '@/config/prisma'

type CleanupJobName = 'otp-cleanup' | 'refresh-token-cleanup' | 'invite-cleanup'

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

  const worker = new Worker('cleanup', processJob, { connection: redisClient, concurrency: 1 })

  worker.on('completed', (job) => console.log(`[cleanup] ${job.name}#${job.id} done`))
  worker.on('failed',    (job, err) => console.error(`[cleanup] ${job?.name}#${job?.id} failed after ${job?.attemptsMade} attempts:`, err.message))
  worker.on('error',     (err) => console.error('[cleanup] worker error:', err.message))

  return worker
}
