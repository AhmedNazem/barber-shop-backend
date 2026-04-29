import { Router } from 'express'
import { authRouter } from '@/routes/auth'
import { shopRouter } from '@/routes/shop'
import { shopsRouter } from '@/routes/shops'

export const router = Router()

router.use('/auth', authRouter)
router.use('/shop', shopRouter)
router.use('/shops', shopsRouter)
