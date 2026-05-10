import { Queue } from 'bullmq'
import Redis from 'ioredis'

// BullMQ requires its own dedicated Redis connections — not shared with redisClient.
// Each Queue internally needs a subscriber connection, so we give each its own IORedis instance.
function makeConnection(): Redis {
  const url = process.env['REDIS_URL']
  if (!url) throw new Error('REDIS_URL is not set')
  return new Redis(url, {
    maxRetriesPerRequest: null,
    enableReadyCheck: false,
    lazyConnect: true,
  })
}

const defaultJobOptions = {
  attempts: 3,
  backoff: { type: 'exponential' as const, delay: 2000 },
}

function createQueue(name: string): Queue {
  return new Queue(name, { connection: makeConnection(), defaultJobOptions })
}

type QueueMap = {
  hairAnalysis: Queue
  notification: Queue
  loyalty: Queue
  cleanup: Queue
}

const globalForQueues = globalThis as unknown as { _queues?: QueueMap }

function initQueues(): QueueMap {
  return {
    hairAnalysis: createQueue('hair-analysis'),
    notification: createQueue('notifications'),
    loyalty:      createQueue('loyalty'),
    cleanup:      createQueue('cleanup'),
  }
}

const queues: QueueMap = globalForQueues._queues ?? initQueues()

if (process.env['NODE_ENV'] !== 'production') {
  globalForQueues._queues = queues
}

export const hairAnalysisQueue = queues.hairAnalysis
export const notificationQueue = queues.notification
export const loyaltyQueue      = queues.loyalty
export const cleanupQueue      = queues.cleanup
