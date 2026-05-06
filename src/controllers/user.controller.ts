import { Request, Response, NextFunction } from 'express'
import { ok } from '@/lib/response'
import { prisma } from '@/config/prisma'
import { getLoyalty, redeemReward } from '@/services/loyalty.service'
import { getReliability } from '@/services/reliability.service'
import { AppError } from '@/lib/errors'

// ─── Loyalty ──────────────────────────────────────────────────────────────────

export async function getLoyaltyHandler(req: Request, res: Response, next: NextFunction) {
  try {
    ok(res, await getLoyalty(req.user!.id))
  } catch (err) { next(err) }
}

export async function redeemRewardHandler(req: Request, res: Response, next: NextFunction) {
  try {
    await redeemReward(req.user!.id, req.body.rewardId)
    ok(res, { ok: true })
  } catch (err) { next(err) }
}

// ─── Reliability ──────────────────────────────────────────────────────────────

export async function getReliabilityHandler(req: Request, res: Response, next: NextFunction) {
  try {
    ok(res, await getReliability(req.user!.id))
  } catch (err) { next(err) }
}

// ─── VIP ──────────────────────────────────────────────────────────────────────

export async function getVipHandler(req: Request, res: Response, next: NextFunction) {
  try {
    const user = await prisma.user.findUnique({
      where:  { id: req.user!.id },
      select: { isVip: true, vipGrantedAt: true },
    })
    if (!user) throw new AppError('not_found', 404)
    ok(res, user)
  } catch (err) { next(err) }
}

// ─── Hair Profile ─────────────────────────────────────────────────────────────

export async function getHairProfileHandler(req: Request, res: Response, next: NextFunction) {
  try {
    const profile = await prisma.hairProfile.findUnique({ where: { userId: req.user!.id } })
    if (!profile) throw new AppError('not_found', 404)
    ok(res, profile)
  } catch (err) { next(err) }
}

export async function upsertHairProfileHandler(req: Request, res: Response, next: NextFunction) {
  try {
    const userId = req.user!.id
    const { dryness, damage, scalpCondition, lastTreatmentDate, cutFrequencyWeeks } = req.body

    const profile = await prisma.hairProfile.upsert({
      where:  { userId },
      update: { dryness, damage, scalpCondition, lastTreatmentDate, cutFrequencyWeeks },
      create: { userId, dryness, damage, scalpCondition, lastTreatmentDate, cutFrequencyWeeks },
    })
    ok(res, profile)
  } catch (err) { next(err) }
}

export async function getHairHistoryHandler(req: Request, res: Response, next: NextFunction) {
  try {
    const limit = Math.min(Number(req.query['limit']) || 10, 50)
    const history = await prisma.hairAnalysisHistory.findMany({
      where:   { userId: req.user!.id },
      orderBy: { createdAt: 'desc' },
      take:    limit,
    })
    ok(res, history)
  } catch (err) { next(err) }
}
