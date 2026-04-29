import { Router } from 'express'
import { listShopsHandler, getShopHandler } from '@/controllers/shop.controller'

export const shopsRouter = Router()

shopsRouter.get('/', listShopsHandler)
shopsRouter.get('/:id', getShopHandler)
