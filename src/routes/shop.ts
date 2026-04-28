import { Router } from 'express'
import { authenticate } from '@/middleware/auth'
import { requireRole } from '@/middleware/require-role'
import { getShopStatusHandler } from '@/controllers/shop.controller'

export const shopRouter = Router()

shopRouter.get('/status', authenticate, requireRole('SHOP_OWNER'), getShopStatusHandler)
