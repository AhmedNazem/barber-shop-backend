import { Router } from 'express'
import { authRouter } from '@/routes/auth'
import { shopRouter } from '@/routes/shop'

export const router = Router()

router.use('/auth', authRouter)
router.use('/shop', shopRouter)
