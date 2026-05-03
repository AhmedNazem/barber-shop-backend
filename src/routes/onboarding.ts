import { Router } from 'express'
import { z } from 'zod'
import { validate } from '@/middleware/validate'
import { authenticate } from '@/middleware/auth'
import { requireRole } from '@/middleware/require-role'
import { brandingImages } from '@/lib/upload'
import {
  onboardBasicsHandler, onboardBrandingHandler,
  onboardServicesHandler, onboardHoursHandler, onboardSubmitHandler,
} from '@/controllers/onboarding.controller'

const basicsSchema = z.object({
  nameEn:        z.string().min(2),
  nameAr:        z.string().min(2),
  address:       z.string().min(2),
  city:          z.string().min(2),
  neighborhood:  z.string().min(2),
  neighborhoodAr: z.string().min(2),
  phone:         z.string().min(7),
  lat:           z.number(),
  lng:           z.number(),
})

const servicesSchema = z.object({
  services: z.array(z.object({
    nameEn:      z.string().min(2),
    nameAr:      z.string().min(2),
    category:    z.string().min(1),
    price:       z.number().int().min(1),
    durationMin: z.number().int().min(1),
  })).min(1),
})

const daySchema = z.object({ closed: z.boolean(), open: z.string(), close: z.string() })
const hoursSchema = z.object({
  mon: daySchema, tue: daySchema, wed: daySchema,
  thu: daySchema, fri: daySchema, sat: daySchema, sun: daySchema,
})

export const onboardingRouter = Router()

const guard = [authenticate, requireRole('SHOP_OWNER')]

onboardingRouter.post('/basics',   ...guard, validate(basicsSchema),   onboardBasicsHandler)
onboardingRouter.post('/branding', ...guard, brandingImages(),          onboardBrandingHandler)
onboardingRouter.post('/services', ...guard, validate(servicesSchema),  onboardServicesHandler)
onboardingRouter.post('/hours',    ...guard, validate(hoursSchema),     onboardHoursHandler)
onboardingRouter.post('/submit',   ...guard,                            onboardSubmitHandler)
