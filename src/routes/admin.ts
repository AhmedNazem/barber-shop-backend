import { Router } from 'express'
import { z } from 'zod'
import { validate } from '@/middleware/validate'
import { authenticate } from '@/middleware/auth'
import { requireRole } from '@/middleware/require-role'
import { approveShopHandler, rejectShopHandler, suspendShopHandler } from '@/controllers/admin.controller'

const rejectSchema  = z.object({ reason: z.string().min(2), reasonAr: z.string().min(2) })
const suspendSchema = z.object({ reason: z.string().min(2) })

export const adminRouter = Router()

const guard = [authenticate, requireRole('ADMIN')]

adminRouter.patch('/shops/:id/approve', ...guard,                       approveShopHandler)
adminRouter.patch('/shops/:id/reject',  ...guard, validate(rejectSchema),  rejectShopHandler)
adminRouter.patch('/shops/:id/suspend', ...guard, validate(suspendSchema), suspendShopHandler)
