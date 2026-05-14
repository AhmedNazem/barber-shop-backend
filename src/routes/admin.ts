import { Router } from 'express'
import { z } from 'zod'
import { validate } from '@/middleware/validate'
import { authenticate } from '@/middleware/auth'
import { requireRole } from '@/middleware/require-role'
import {
  approveShopHandler, rejectShopHandler, suspendShopHandler, suspendPreviewHandler,
  listPendingShopsHandler, listAllShopsHandler,
  getPlatformConfigHandler, updatePlatformConfigHandler, testSmsHandler,
  listUsersHandler, getUserHandler, changeRoleHandler, suspendUserHandler, deleteUserHandler,
  unblockUserHandler, grantVipHandler, getAdminStatsHandler,
  listAllBookingsHandler, forceCancelBookingHandler,
  listFlaggedReviewsHandler,
} from '@/controllers/admin.controller'
import { getKpisHandler, getRevenueHandler, getTopShopsHandler, getPeakHoursHandler } from '@/controllers/analytics.controller'
import {
  listPendingPaymentsHandler,
  confirmPaymentHandler,
  rejectPaymentHandler,
} from '@/controllers/manual-payment.controller'
import {
  handleListPendingPlanPayments,
  handleConfirmPlanPayment,
  handleRejectPlanPayment,
} from '@/controllers/plan-payment.controller'
import { updateShopPlanHandler } from '@/controllers/shop.controller'

const rejectSchema  = z.object({ reason: z.string().min(2), reasonAr: z.string().min(2) })
const suspendSchema = z.object({ reason: z.string().min(2) })
const planSchema    = z.object({
  plan:      z.enum(['FREE', 'STARTER', 'PRO']),
  expiresAt: z.string().datetime().optional(),
})
const roleSchema    = z.object({ role: z.enum(['CUSTOMER', 'BARBER', 'SHOP_OWNER']) })
const testSmsSchema = z.object({ phone: z.string().min(1) })

const platformConfigSchema = z.object({
  maintenanceMode:       z.boolean().optional(),
  defaultDepositPercent: z.number().int().min(1).max(100).optional(),
  commissionPercent:     z.number().min(1).max(50).optional(),
  smsProvider:           z.enum(['unifonic', 'twilio']).optional(),
  smsApiKey:             z.string().min(1).optional(),
  smsSenderId:           z.string().min(1).optional(),
})

export const adminRouter = Router()

const guard = [authenticate, requireRole('ADMIN')]

// ─── Overview stats ───────────────────────────────────────────────────────────
adminRouter.get('/stats', ...guard, getAdminStatsHandler)

// ─── Shop management ──────────────────────────────────────────────────────────
adminRouter.get(  '/shops',                      ...guard,                          listAllShopsHandler)
adminRouter.get(  '/shops/pending',              ...guard,                          listPendingShopsHandler)
adminRouter.patch('/shops/:id/approve',          ...guard,                          approveShopHandler)
adminRouter.patch('/shops/:id/reject',           ...guard, validate(rejectSchema),  rejectShopHandler)
adminRouter.patch('/shops/:id/suspend',          ...guard, validate(suspendSchema), suspendShopHandler)
adminRouter.get(  '/shops/:id/suspend-preview',  ...guard,                          suspendPreviewHandler)
adminRouter.patch('/shops/:id/plan',             ...guard, validate(planSchema),     updateShopPlanHandler)

// ─── Platform config ──────────────────────────────────────────────────────────
adminRouter.get(  '/platform-config',            ...guard,                                    getPlatformConfigHandler)
adminRouter.patch('/platform-config',            ...guard, validate(platformConfigSchema),     updatePlatformConfigHandler)
adminRouter.post( '/platform-config/test-sms',   ...guard, validate(testSmsSchema),            testSmsHandler)

// ─── User management ──────────────────────────────────────────────────────────
adminRouter.get(   '/users',          ...guard,                       listUsersHandler)
adminRouter.get(   '/users/:id',      ...guard,                       getUserHandler)
adminRouter.patch( '/users/:id/role', ...guard, validate(roleSchema), changeRoleHandler)
adminRouter.patch( '/users/:id/suspend', ...guard,                    suspendUserHandler)
adminRouter.delete('/users/:id',         ...guard, deleteUserHandler)
adminRouter.post(  '/users/:id/unblock', ...guard, unblockUserHandler)
adminRouter.post(  '/users/:id/vip',     ...guard, grantVipHandler)

// ─── Booking management ───────────────────────────────────────────────────────
const cancelSchema = z.object({ reason: z.string().min(2) })

adminRouter.get(  '/bookings',             ...guard,                        listAllBookingsHandler)
adminRouter.patch('/bookings/:id/cancel',  ...guard, validate(cancelSchema), forceCancelBookingHandler)

// ─── Analytics ────────────────────────────────────────────────────────────────
adminRouter.get('/analytics/kpis',       ...guard, getKpisHandler)
adminRouter.get('/analytics/revenue',    ...guard, getRevenueHandler)
adminRouter.get('/analytics/top-shops',  ...guard, getTopShopsHandler)
adminRouter.get('/analytics/peak-hours', ...guard, getPeakHoursHandler)

// ─── Review moderation ────────────────────────────────────────────────────────
adminRouter.get('/reviews/flagged', ...guard, listFlaggedReviewsHandler)

// ─── Manual payment review ────────────────────────────────────────────────────
const rejectPaymentSchema = z.object({ reason: z.string().min(2) })

adminRouter.get(  '/payments/pending',      ...guard,                                    listPendingPaymentsHandler)
adminRouter.post( '/payments/:id/confirm',  ...guard,                                    confirmPaymentHandler)
adminRouter.post( '/payments/:id/reject',   ...guard, validate(rejectPaymentSchema),     rejectPaymentHandler)

// ─── Plan payment review (subscriptions) ─────────────────────────────────────
const rejectPlanSchema = z.object({ rejectReason: z.string().min(2) })

adminRouter.get(  '/subscriptions/pending',     ...guard,                             handleListPendingPlanPayments)
adminRouter.post( '/subscriptions/:id/confirm', ...guard,                             handleConfirmPlanPayment)
adminRouter.post( '/subscriptions/:id/reject',  ...guard, validate(rejectPlanSchema), handleRejectPlanPayment)
