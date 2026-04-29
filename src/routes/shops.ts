import { Router } from 'express'
import { z } from 'zod'
import { validate } from '@/middleware/validate'
import { authenticate } from '@/middleware/auth'
import { requireRole } from '@/middleware/require-role'
import { createShopHandler, updateShopHandler, uploadImageHandler, listShopsHandler, getShopHandler } from '@/controllers/shop.controller'
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
