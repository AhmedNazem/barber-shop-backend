import { Queue, Worker } from 'bullmq'
import { redisClient } from '@/lib/redis'
import { syncAnbarShops } from '@/services/shop-sync.service'

const QUEUE_NAME = 'sync-shops'
const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000

export const syncShopsQueue = new Queue(QUEUE_NAME, { connection: redisClient })

async function processJob() {
  const stats = await syncAnbarShops()
  const total = stats.reduce((sum, s) => sum + s.upserted, 0)
  console.log(`[sync-shops] complete — ${total} shops total`)
}

export async function startSyncShopsWorker() {
  // Stable jobId prevents duplicate schedules on every server restart
  await syncShopsQueue.add('sync-anbar', {}, {
    repeat:  { every: THIRTY_DAYS_MS },
    jobId:   'sync-anbar-monthly',
  })

  const worker = new Worker(QUEUE_NAME, processJob, { connection: redisClient })

  worker.on('completed', job  => console.log(`[sync-shops] ${job.id} done`))
  worker.on('failed',    (job, err) => console.error(`[sync-shops] ${job?.id} failed:`, err.message))
  worker.on('error',     err  => console.error('[sync-shops] worker error:', err.message))

  return worker
}
