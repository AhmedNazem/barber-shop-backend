import { Request, Response, NextFunction } from 'express'
import { randomUUID } from 'crypto'
import { prisma } from '@/config/prisma'
import { redisClient } from '@/lib/redis'
import { uploadToS3 } from '@/lib/s3'
import { processHairAnalysisJob } from '@/jobs/hair-analysis.worker'
import { AppError } from '@/lib/errors'

export async function submitHairAnalysisHandler(req: Request, res: Response, next: NextFunction) {
  try {
    const userId   = req.user!.id
    const file     = req.file!
    const rawKey   = `hair-analysis/${userId}/${Date.now()}.${file.mimetype.split('/')[1]}`
    const jobId    = randomUUID()

    const imageKey = await uploadToS3(rawKey, file.buffer, file.mimetype)

    await prisma.hairProfile.upsert({
      where:  { userId },
      update: {},
      create: { userId, dryness: 3, damage: 3, scalpCondition: 'normal', cutFrequencyWeeks: 4 },
    })

    await prisma.hairAnalysis.create({
      data: { userId, jobId, imageKey, status: 'processing' },
    })

    await redisClient.set(`hair-analysis:${jobId}`, JSON.stringify({ status: 'processing' }), 'EX', 3600)

    res.status(202).json({ data: { jobId } })

    // Run analysis in background after response is sent
    setImmediate(() => {
      processHairAnalysisJob(jobId, { userId, imageKey, mimeType: file.mimetype }).catch((err) => {
        console.error('[hair-analysis] background job failed:', err.message)
      })
    })
  } catch (err) { next(err) }
}

export async function getHairAnalysisHandler(req: Request, res: Response, next: NextFunction) {
  try {
    const { jobId } = req.params as { jobId: string }
    const raw = await redisClient.get(`hair-analysis:${jobId}`)
    if (!raw) throw new AppError('not_found', 404)
    res.json({ data: JSON.parse(raw) })
  } catch (err) { next(err) }
}
