import { Router } from 'express'
import { authenticate } from '@/middleware/auth'
import { requireRole } from '@/middleware/require-role'
import {
  getSavedShopsHandler,
  saveShopHandler,
  unsaveShopHandler,
  getLoyaltyHandler,
} from '@/controllers/account.controller'

export const accountRouter = Router()

const guard = [authenticate, requireRole('CUSTOMER')]

accountRouter.get(   '/saved-shops',         ...guard, getSavedShopsHandler)
accountRouter.post(  '/saved-shops/:shopId', ...guard, saveShopHandler)
accountRouter.delete('/saved-shops/:shopId', ...guard, unsaveShopHandler)
accountRouter.get(   '/loyalty',             ...guard, getLoyaltyHandler)
