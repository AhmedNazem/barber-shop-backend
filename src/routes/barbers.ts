import { Router } from 'express'
import { z } from 'zod'
import { validate } from '@/middleware/validate'
import { authenticate } from '@/middleware/auth'
import { requireRole } from '@/middleware/require-role'
import { listBarbersHandler, createBarberHandler, updateBarberHandler, deactivateBarberHandler, setScheduleHandler } from '@/controllers/barber.controller'

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

barbersRouter.get('/', listBarbersHandler)
barbersRouter.post('/', authenticate, requireRole('SHOP_OWNER'), validate(createBarberSchema), createBarberHandler)
barbersRouter.patch('/:barberId', authenticate, requireRole('SHOP_OWNER'), validate(updateBarberSchema), updateBarberHandler)
barbersRouter.delete('/:barberId', authenticate, requireRole('SHOP_OWNER'), deactivateBarberHandler)
barbersRouter.patch('/:barberId/schedule', authenticate, requireRole('SHOP_OWNER'), validate(scheduleSchema), setScheduleHandler)
