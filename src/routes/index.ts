import { Router } from 'express'
import { authRouter } from '@/routes/auth'

export const router = Router()

router.use('/auth', authRouter)
