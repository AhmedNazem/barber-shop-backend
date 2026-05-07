import { Queue, Worker, Job } from 'bullmq'
import { redisClient } from '@/lib/redis'
import { downloadFromS3 } from '@/lib/s3'
import { analyzeHairImage } from '@/services/hair-analysis.service'
import { prisma } from '@/config/prisma'

const REDIS_TTL = 3600
const QUEUE_NAME = 'hair-analysis'

const connection = redisClient

export const hairAnalysisQueue = new Queue(QUEUE_NAME, { connection })

export type HairJobData = {
  userId:   string
  imageKey: string
  mimeType: string
}

async function processJob(job: Job<HairJobData>) {
  const { userId, imageKey, mimeType } = job.data
  const key = `hair-analysis:${job.id}`

  try {
    const buffer = await downloadFromS3(imageKey)
    const result = await analyzeHairImage(buffer, mimeType)

    await redisClient.set(key, JSON.stringify({ status: 'done', result }), 'EX', REDIS_TTL)

    await prisma.hairAnalysis.update({
      where: { jobId: job.id! },
      data: {
        hairType:          result.hairType,
        conditionScore:    result.conditionScore,
        recommendations:   result.recommendations,
        suggestedServices: result.suggestedServices,
        status:            'done',
      },
    })

    const profile = await prisma.hairProfile.findUnique({ where: { userId } })
    await prisma.hairAnalysisHistory.create({
      data: {
        userId,
        hairType:       result.hairType,
        conditionScore: result.conditionScore,
        dryness:        profile?.dryness        ?? 3,
        damage:         profile?.damage         ?? 3,
        scalpCondition: profile?.scalpCondition ?? 'normal',
      },
    })
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'unknown'
    await redisClient.set(key, JSON.stringify({ status: 'error', error: msg }), 'EX', REDIS_TTL)
    await prisma.hairAnalysis.update({ where: { jobId: job.id! }, data: { status: 'error' } }).catch(() => {})
    throw err
  }
}

// Thin wrapper for unit tests — lets tests invoke job logic without a real BullMQ Job object
export function processHairAnalysisJob(jobId: string, data: HairJobData) {
  return processJob({ id: jobId, data } as Job<HairJobData>)
}

export function startHairAnalysisWorker() {
  const worker = new Worker<HairJobData>(QUEUE_NAME, processJob, { connection })

  worker.on('completed', (job) => console.log(`[hair-analysis] job ${job.id} completed`))
  worker.on('failed', (job, err) => console.error(`[hair-analysis] job ${job?.id} failed:`, err.message))
  worker.on('error', (err) => console.error('[hair-analysis] worker error:', err.message))

  return worker
}
