import { Router } from 'express'
import { authenticate } from '@/middleware/auth'
import { requireRole } from '@/middleware/require-role'
import { deleteServicePhotoHandler } from '@/controllers/service.controller'

export const photosRouter = Router()

photosRouter.delete('/:photoId', authenticate, requireRole('SHOP_OWNER'), deleteServicePhotoHandler)
