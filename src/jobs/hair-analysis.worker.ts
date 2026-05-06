import { redisClient } from '@/lib/redis'
import { downloadFromS3 } from '@/lib/s3'
import { analyzeHairImage } from '@/services/hair-analysis.service'
import { prisma } from '@/config/prisma'

const REDIS_TTL = 3600 // 1 hour

export type HairJobData = {
  userId:    string
  imageKey:  string
  mimeType:  string
}

export async function processHairAnalysisJob(jobId: string, data: HairJobData) {
  const key = `hair-analysis:${jobId}`

  try {
    const buffer = await downloadFromS3(data.imageKey)
    const result = await analyzeHairImage(buffer, data.mimeType)

    await redisClient.set(key, JSON.stringify({ status: 'done', result }), 'EX', REDIS_TTL)

    await prisma.hairAnalysis.update({
      where: { jobId },
      data: {
        hairType:          result.hairType,
        conditionScore:    result.conditionScore,
        recommendations:   result.recommendations,
        suggestedServices: result.suggestedServices,
        status:            'done',
      },
    })

    const profile = await prisma.hairProfile.findUnique({ where: { userId: data.userId } })
    await prisma.hairAnalysisHistory.create({
      data: {
        userId:         data.userId,
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
    await prisma.hairAnalysis.update({ where: { jobId }, data: { status: 'error' } }).catch(() => {})
    throw err
  }
}

