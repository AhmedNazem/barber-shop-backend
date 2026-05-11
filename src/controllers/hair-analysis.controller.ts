import { Request, Response, NextFunction } from 'express'
import { prisma } from '@/config/prisma'
import { redisClient } from '@/lib/redis'
import { uploadToS3 } from '@/lib/s3'
import { hairAnalysisQueue } from '@/jobs/hair-analysis.worker'
import { AppError } from '@/lib/errors'

export async function submitHairAnalysisHandler(req: Request, res: Response, next: NextFunction) {
  try {
    const userId   = req.user!.id
    const file     = req.file!
    const rawKey   = `hair-analysis/${userId}/${Date.now()}.${file.mimetype.split('/')[1]}`

    const imageKey = await uploadToS3(rawKey, file.buffer, file.mimetype)

    await prisma.hairProfile.upsert({
      where:  { userId },
      update: {},
      create: { userId, dryness: 3, damage: 3, scalpCondition: 'normal', cutFrequencyWeeks: 4 },
    })

    const locale = typeof req.body?.locale === 'string' ? req.body.locale : 'en'
    const job = await hairAnalysisQueue.add('analyze', { userId, imageKey, mimeType: file.mimetype, locale })

    await prisma.hairAnalysis.create({
      data: { userId, jobId: job.id!, imageKey, status: 'processing' },
    })

    await redisClient.set(`hair-analysis:${job.id}`, JSON.stringify({ status: 'processing' }), 'EX', 3600)

    res.status(202).json({ data: { jobId: job.id } })
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
