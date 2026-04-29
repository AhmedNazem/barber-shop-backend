import { Router } from 'express'
import { z } from 'zod'
import { validate } from '@/middleware/validate'
import { authenticate } from '@/middleware/auth'
import { requireRole } from '@/middleware/require-role'
import { listServicesHandler, createServiceHandler, updateServiceHandler, deleteServiceHandler, uploadServicePhotoHandler, reorderServicePhotosHandler } from '@/controllers/service.controller'
import { singleImage } from '@/lib/upload'

const createServiceSchema = z.object({
  nameEn:      z.string().min(2),
  nameAr:      z.string().min(2),
  price:       z.number().int().positive(),
  durationMin: z.number().int().positive(),
  category:    z.string().min(1),
})

const updateServiceSchema = createServiceSchema.partial().extend({
  isActive: z.boolean().optional(),
})

export const servicesRouter = Router({ mergeParams: true })

servicesRouter.get('/', listServicesHandler)
servicesRouter.post('/', authenticate, requireRole('SHOP_OWNER'), validate(createServiceSchema), createServiceHandler)
servicesRouter.patch('/:serviceId', authenticate, requireRole('SHOP_OWNER'), validate(updateServiceSchema), updateServiceHandler)
servicesRouter.delete('/:serviceId', authenticate, requireRole('SHOP_OWNER'), deleteServiceHandler)
servicesRouter.post('/:serviceId/photos', authenticate, requireRole('SHOP_OWNER'), singleImage('file'), uploadServicePhotoHandler)
servicesRouter.patch('/:serviceId/photos/reorder', authenticate, requireRole('SHOP_OWNER'), validate(z.object({ photoIds: z.array(z.string()).min(1) })), reorderServicePhotosHandler)
