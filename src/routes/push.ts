import { Router } from 'express'
import { authenticate } from '@/middleware/auth'
import { subscribeHandler, unsubscribeHandler } from '@/controllers/push.controller'

export const pushRouter = Router()

pushRouter.post(  '/subscribe',   authenticate, subscribeHandler)
pushRouter.delete('/subscribe',   authenticate, unsubscribeHandler)
