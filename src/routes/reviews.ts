import { Router } from 'express'
import { z } from 'zod'
import { validate } from '@/middleware/validate'
import { authenticate } from '@/middleware/auth'
import { requireRole } from '@/middleware/require-role'
import { multipleImages } from '@/lib/upload'
import { createReviewHandler, flagReviewHandler, resolveFlagHandler } from '@/controllers/review.controller'

const createReviewSchema = z.object({
  bookingId: z.string().min(1),
  rating:    z.coerce.number().int().min(1).max(5),
  comment:   z.string().min(3),
  barberId:  z.string().optional(),
})

const flagSchema = z.object({
  reason: z.enum(['SPAM', 'INAPPROPRIATE', 'FAKE']),
})

const resolveFlagSchema = z.object({
  action:        z.enum(['approve', 'remove']),
  removalReason: z.string().optional(),
})

export const reviewsRouter = Router()

// multipart/form-data — photos[] is optional (0-5 images)
reviewsRouter.post('/',                    authenticate, requireRole('CUSTOMER'), multipleImages('photos', 5), validate(createReviewSchema), createReviewHandler)
reviewsRouter.post('/:reviewId/flag',      authenticate, requireRole('SHOP_OWNER'), validate(flagSchema), flagReviewHandler)
reviewsRouter.patch('/:reviewId/flag',     authenticate, requireRole('ADMIN'), validate(resolveFlagSchema), resolveFlagHandler)
