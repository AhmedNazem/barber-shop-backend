import { Router } from 'express'
import { z } from 'zod'
import { validate } from '@/middleware/validate'
import { authenticate } from '@/middleware/auth'
import { requireRole } from '@/middleware/require-role'

const discountSchema = z.object({
  pct:       z.number().int().min(1).max(100),
  maxUsers:  z.number().int().min(1),
  expiresAt: z.string().datetime(),
})
import { createShopHandler, updateShopHandler, uploadImageHandler, listShopsHandler, getShopHandler, getDiscountHandler, createDiscountHandler, deleteDiscountHandler } from '@/controllers/shop.controller'
import { listShopReviewsHandler } from '@/controllers/review.controller'
import { getShopAvailabilityHandler } from '@/controllers/availability.controller'
import { optionalAuth } from '@/middleware/auth'
import { singleImage } from '@/lib/upload'

const createShopSchema = z.object({
  nameEn:        z.string().min(2),
  nameAr:        z.string().min(2),
  address:       z.string().min(3),
  city:          z.string().min(2),
  neighborhood:  z.string().min(2),
  neighborhoodAr: z.string().min(2),
  phone:         z.string().regex(/^\+964\d{9,10}$/),
  lat:           z.number(),
  lng:           z.number(),
})

const updateShopSchema = createShopSchema.partial()

export const shopsRouter = Router()

shopsRouter.post('/', authenticate, requireRole('SHOP_OWNER'), validate(createShopSchema), createShopHandler)
shopsRouter.get('/', listShopsHandler)
shopsRouter.get('/:id', getShopHandler)
shopsRouter.patch('/:id', authenticate, requireRole('SHOP_OWNER'), validate(updateShopSchema), updateShopHandler)
shopsRouter.post('/:id/cover', authenticate, requireRole('SHOP_OWNER'), singleImage('file'), uploadImageHandler('coverUrl'))
shopsRouter.post('/:id/logo', authenticate, requireRole('SHOP_OWNER'), singleImage('file'), uploadImageHandler('logoUrl'))
shopsRouter.get('/:id/reviews', listShopReviewsHandler)
shopsRouter.get('/:id/availability', optionalAuth, getShopAvailabilityHandler)

// ─── Discount ─────────────────────────────────────────────────────────────────
shopsRouter.get(   '/:id/discount', getDiscountHandler)
shopsRouter.post(  '/:id/discount', authenticate, requireRole('SHOP_OWNER'), validate(discountSchema), createDiscountHandler)
shopsRouter.delete('/:id/discount', authenticate, requireRole('SHOP_OWNER'), deleteDiscountHandler)
