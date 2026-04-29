import { Router } from 'express'
import { z } from 'zod'
import { validate } from '@/middleware/validate'
import { authenticate } from '@/middleware/auth'
import { requireRole } from '@/middleware/require-role'
import { listBarbersHandler, createBarberHandler, updateBarberHandler, deactivateBarberHandler } from '@/controllers/barber.controller'

const createBarberSchema = z.object({
  nameEn:          z.string().min(2),
  nameAr:          z.string().min(2),
  bio:             z.string().optional(),
  bioAr:           z.string().optional(),
  specialties:     z.array(z.string()).optional(),
  experienceYears: z.number().int().min(0).optional(),
})

const updateBarberSchema = createBarberSchema.partial()

export const barbersRouter = Router({ mergeParams: true })

barbersRouter.get('/', listBarbersHandler)
barbersRouter.post('/', authenticate, requireRole('SHOP_OWNER'), validate(createBarberSchema), createBarberHandler)
barbersRouter.patch('/:barberId', authenticate, requireRole('SHOP_OWNER'), validate(updateBarberSchema), updateBarberHandler)
barbersRouter.delete('/:barberId', authenticate, requireRole('SHOP_OWNER'), deactivateBarberHandler)
