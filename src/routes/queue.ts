import { Router } from 'express'
import { z } from 'zod'
import { validate } from '@/middleware/validate'
import { authenticate } from '@/middleware/auth'
import { requireRole } from '@/middleware/require-role'
import {
  getQueueHandler, addWalkInHandler, startServiceHandler,
  doneHandler, noShowHandler, reorderHandler, customerQueueHandler,
} from '@/controllers/queue.controller'

const walkInSchema = z.object({
  customerName: z.string().min(1),
  serviceIds:   z.array(z.string().cuid()).min(1),
  barberId:     z.string().cuid().optional(),
  isVip:        z.boolean().optional(),
})

const reorderSchema = z.object({
  position: z.number().int().min(1),
})

export const queueShopRouter = Router({ mergeParams: true })
export const queueRouter     = Router()

// Shop-scoped routes (mounted at /shops/:shopId/queue)
queueShopRouter.get('/',          authenticate, requireRole('SHOP_OWNER', 'BARBER'), getQueueHandler)
queueShopRouter.post('/walk-in',  authenticate, requireRole('SHOP_OWNER', 'BARBER'), validate(walkInSchema), addWalkInHandler)

// Entry-level routes (mounted at /queue)
queueRouter.get('/:bookingId',              authenticate, requireRole('CUSTOMER'), customerQueueHandler)
queueRouter.patch('/:entryId/start',        authenticate, requireRole('SHOP_OWNER', 'BARBER'), startServiceHandler)
queueRouter.patch('/:entryId/done',         authenticate, requireRole('SHOP_OWNER', 'BARBER'), doneHandler)
queueRouter.patch('/:entryId/no-show',      authenticate, requireRole('SHOP_OWNER', 'BARBER'), noShowHandler)
queueRouter.patch('/:entryId/reorder',      authenticate, requireRole('SHOP_OWNER'), validate(reorderSchema), reorderHandler)
