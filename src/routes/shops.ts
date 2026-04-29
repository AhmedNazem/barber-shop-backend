import { Router } from 'express'
import { listShopsHandler } from '@/controllers/shop.controller'

export const shopsRouter = Router()

shopsRouter.get('/', listShopsHandler)
