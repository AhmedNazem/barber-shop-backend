import { Router, Request, Response, NextFunction } from 'express'
import rateLimit from 'express-rate-limit'
import { z } from 'zod'
import { validate } from '@/middleware/validate'
import { requestOtp } from '@/services/otp.service'
import { ok } from '@/lib/response'
import { env } from '@/config/env'

export const authRouter = Router()

// Iraqi mobile: 07XXXXXXXX | 7XXXXXXXX | +9647XXXXXXXX
const phoneSchema = z.object({
  phone: z
    .string()
    .regex(/^(\+9647|9647|07|7)\d{8,9}$/, 'invalid_phone'),
})

// 3 requests per minute per IP — tighter than the global 100/min limiter
const otpRateLimit = rateLimit({
  windowMs: 60 * 1000,
  limit: 3,
  skipFailedRequests: false,
  standardHeaders: true,
  legacyHeaders: false,
  skip: () => env.NODE_ENV === 'test',
  message: { error: 'rate_limited', retryAfter: 60 },
})

authRouter.post(
  '/request-otp',
  otpRateLimit,
  validate(phoneSchema),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { phone } = req.body as z.infer<typeof phoneSchema>
      await requestOtp(phone)
      ok(res, { ok: true })
    } catch (err) {
      next(err)
    }
  },
)
