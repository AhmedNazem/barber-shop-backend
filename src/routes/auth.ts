import { Router } from 'express'
import rateLimit from 'express-rate-limit'
import { z } from 'zod'
import { validate } from '@/middleware/validate'
import { authenticate } from '@/middleware/auth'
import {
  requestOtpHandler,
  verifyOtpHandler,
  refreshHandler,
  meHandler,
  logoutHandler,
} from '@/controllers/auth.controller'

export const authRouter = Router()

const phoneSchema = z.object({
  phone: z.string().regex(/^(\+9647|9647|07|7)\d{8,9}$/, 'invalid_phone'),
})

const verifyOtpSchema = z.object({
  phone: z.string().regex(/^(\+9647|9647|07|7)\d{8,9}$/, 'invalid_phone'),
  otp: z.string().length(6, 'invalid_otp'),
  name: z.string().optional(),
  shopName: z.string().optional(),
  isRegister: z.boolean().optional(),
})

const otpRateLimit = rateLimit({
  windowMs: 60 * 1000,
  limit: 3,
  skipFailedRequests: false,
  standardHeaders: true,
  legacyHeaders: false,
  skip: () => process.env['NODE_ENV'] === 'test',
  message: { error: 'rate_limited', retryAfter: 60 },
})

authRouter.post('/request-otp', otpRateLimit, validate(phoneSchema), requestOtpHandler)
authRouter.post('/verify-otp', validate(verifyOtpSchema), verifyOtpHandler)
authRouter.post('/refresh', refreshHandler)
authRouter.get('/me', authenticate, meHandler)
authRouter.post('/logout', authenticate, logoutHandler)
