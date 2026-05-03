import { Router } from 'express'
import { authenticate } from '@/middleware/auth'
import { getNotificationsHandler, markReadHandler, markAllReadHandler } from '@/controllers/notification.controller'

export const notificationsRouter = Router()

notificationsRouter.get('/',           authenticate, getNotificationsHandler)
notificationsRouter.patch('/read-all', authenticate, markAllReadHandler)
notificationsRouter.patch('/:id/read', authenticate, markReadHandler)
