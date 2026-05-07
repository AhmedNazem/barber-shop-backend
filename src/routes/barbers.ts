import { Router } from 'express'
import { z } from 'zod'
import { validate } from '@/middleware/validate'
import { authenticate } from '@/middleware/auth'
import { requireRole } from '@/middleware/require-role'
import { requireOwnership } from '@/middleware/require-ownership'
import { listBarbersHandler, createBarberHandler, updateBarberHandler, deactivateBarberHandler, setScheduleHandler } from '@/controllers/barber.controller'
import { uploadPortfolioPhotoHandler, deletePortfolioPhotoHandler, reorderPortfolioPhotosHandler } from '@/controllers/barber-portfolio.controller'
import { singleImage } from '@/lib/upload'

const createBarberSchema = z.object({
  nameEn:          z.string().min(2),
  nameAr:          z.string().min(2),
  bio:             z.string().optional(),
  bioAr:           z.string().optional(),
  specialties:     z.array(z.string()).optional(),
  experienceYears: z.number().int().min(0).optional(),
})

const updateBarberSchema = createBarberSchema.partial()

const scheduleEntrySchema = z.object({
  dayOfWeek:   z.number().int().min(0).max(6),
  startTime:   z.string().regex(/^\d{2}:\d{2}$/),
  endTime:     z.string().regex(/^\d{2}:\d{2}$/),
  isAvailable: z.boolean(),
})

const scheduleSchema = z.array(scheduleEntrySchema).min(1).max(7)

export const barbersRouter = Router({ mergeParams: true })

const ownerGuard = [authenticate, requireRole('SHOP_OWNER'), requireOwnership((req) => req.params['shopId'])]

const reorderSchema = z.object({ photoIds: z.array(z.string()).min(1) })

barbersRouter.get('/', listBarbersHandler)
barbersRouter.post('/',                              ...ownerGuard, validate(createBarberSchema), createBarberHandler)
barbersRouter.patch('/:barberId',                    ...ownerGuard, validate(updateBarberSchema), updateBarberHandler)
barbersRouter.delete('/:barberId',                   ...ownerGuard, deactivateBarberHandler)
barbersRouter.patch('/:barberId/schedule',           ...ownerGuard, validate(scheduleSchema), setScheduleHandler)
barbersRouter.post('/:barberId/portfolio',           ...ownerGuard, singleImage('photo'), uploadPortfolioPhotoHandler)
barbersRouter.delete('/:barberId/portfolio/:photoId',...ownerGuard, deletePortfolioPhotoHandler)
barbersRouter.patch('/:barberId/portfolio/reorder',  ...ownerGuard, validate(reorderSchema), reorderPortfolioPhotosHandler)
