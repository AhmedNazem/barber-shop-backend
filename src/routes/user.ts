import { Router } from 'express'
import { z } from 'zod'
import { validate } from '@/middleware/validate'
import { authenticate } from '@/middleware/auth'
import { requireRole } from '@/middleware/require-role'
import {
  getLoyaltyHandler, redeemRewardHandler,
  getReliabilityHandler,
  getVipHandler,
  getHairProfileHandler, upsertHairProfileHandler, getHairHistoryHandler,
} from '@/controllers/user.controller'

const redeemSchema = z.object({ rewardId: z.string().cuid() })

const hairProfileSchema = z.object({
  dryness:           z.number().int().min(1).max(5),
  damage:            z.number().int().min(1).max(5),
  scalpCondition:    z.string().min(1),
  lastTreatmentDate: z.string().optional(),
  cutFrequencyWeeks: z.number().int().min(1),
})

export const userRouter = Router()

const guard = [authenticate, requireRole('CUSTOMER')]

// ─── Loyalty ──────────────────────────────────────────────────────────────────
userRouter.get( '/loyalty',        ...guard,                       getLoyaltyHandler)
userRouter.post('/loyalty/redeem', ...guard, validate(redeemSchema), redeemRewardHandler)

// ─── Reliability ──────────────────────────────────────────────────────────────
userRouter.get('/reliability', ...guard, getReliabilityHandler)

// ─── VIP ──────────────────────────────────────────────────────────────────────
userRouter.get('/vip', ...guard, getVipHandler)

// ─── Hair Profile ─────────────────────────────────────────────────────────────
userRouter.get('/hair-profile',    ...guard,                            getHairProfileHandler)
userRouter.put('/hair-profile',    ...guard, validate(hairProfileSchema), upsertHairProfileHandler)
userRouter.get('/hair-history',    ...guard,                            getHairHistoryHandler)
