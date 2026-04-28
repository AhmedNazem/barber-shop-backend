import { Router, Request, Response, NextFunction } from 'express'
import rateLimit from 'express-rate-limit'
import { z } from 'zod'
import { validate } from '@/middleware/validate'
import { requestOtp, verifyOtp } from '@/services/otp.service'
import { ok } from '@/lib/response'
import { env } from '@/config/env'
import { prisma } from '@/config/prisma'
import { signAccess, signRefresh, verifyRefresh } from '@/lib/jwt'
import { AppError } from '@/lib/errors'
import { normalisePhone } from '@/lib/sms'
import { authenticate } from '@/middleware/auth'

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
  skip: () => process.env['NODE_ENV'] === 'test',
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

const verifyOtpSchema = z.object({
  phone: z.string().regex(/^(\+9647|9647|07|7)\d{8,9}$/, 'invalid_phone'),
  otp: z.string().length(6, 'invalid_otp'),
  name: z.string().optional(),
  shopName: z.string().optional(),
  isRegister: z.boolean().optional(),
})

authRouter.post(
  '/verify-otp',
  validate(verifyOtpSchema),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { phone, otp, name, shopName, isRegister } = req.body as z.infer<typeof verifyOtpSchema>
      const e164 = normalisePhone(phone)

      // 1. Verify the OTP (throws AppError if invalid/expired/locked)
      await verifyOtp(e164, otp)

      // 2. Create or find User — always look up by normalized E.164 phone
      let user = await prisma.user.findUnique({ where: { phone: e164 } })

      if (isRegister) {
        if (!user) {
          if (!name) throw new AppError('name_required', 400)
          user = await prisma.user.create({
            data: {
              phone: e164,
              name,
              role: shopName ? 'SHOP_OWNER' : 'CUSTOMER',
            },
          })
        }
      } else {
        if (!user) throw new AppError('user_not_found', 404)
      }

      // 3. Issue Tokens
      const payload = { id: user.id, role: user.role, shopId: user.shopId || undefined }
      const accessToken = signAccess(payload)
      const refreshToken = signRefresh(payload)

      // 4. Store Refresh Token in DB
      const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000) // 7 days
      await prisma.refreshToken.create({
        data: {
          userId: user.id,
          token: refreshToken,
          expiresAt,
        },
      })

      // 5. Set Cookie & Return
      res.cookie('refreshToken', refreshToken, {
        httpOnly: true,
        secure: env.NODE_ENV === 'production',
        sameSite: 'lax',
        path: '/api/v1/auth/refresh',
        maxAge: 7 * 24 * 60 * 60 * 1000, // 7 days in ms
      })

      ok(res, { accessToken, refreshToken, role: user.role })
    } catch (err) {
      next(err)
    }
  },
)

// ─── S2.5 POST /auth/refresh ──────────────────────────────────────────────────

authRouter.post(
  '/refresh',
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      // Accept token from httpOnly cookie (browser) or request body (mobile / BFF)
      const token: string | undefined = req.cookies?.refreshToken ?? req.body?.refreshToken

      if (!token) throw new AppError('unauthorized', 401)

      // 1. Verify JWT signature — throws if tampered or expired
      let payload: ReturnType<typeof verifyRefresh>
      try {
        payload = verifyRefresh(token)
      } catch {
        throw new AppError('unauthorized', 401)
      }

      // 2. Check the token exists in DB (proves it hasn't been revoked via logout)
      const stored = await prisma.refreshToken.findUnique({ where: { token } })
      if (!stored || stored.expiresAt < new Date()) {
        throw new AppError('unauthorized', 401)
      }

      // 3. Issue a fresh access token — refresh token itself is NOT rotated here
      const accessToken = signAccess({
        id: payload.id,
        role: payload.role,
        shopId: payload.shopId,
      })

      ok(res, { accessToken })
    } catch (err) {
      next(err)
    }
  },
)

// ─── S2.6 POST /auth/logout ───────────────────────────────────────────────────

authRouter.post(
  '/logout',
  authenticate,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const token: string | undefined = req.cookies?.refreshToken ?? req.body?.refreshToken

      if (token) {
        // Delete the specific refresh token — other devices stay logged in
        await prisma.refreshToken.deleteMany({ where: { token } })
      }

      // Clear the httpOnly cookie regardless
      res.clearCookie('refreshToken', { path: '/api/v1/auth/refresh' })

      ok(res, { ok: true })
    } catch (err) {
      next(err)
    }
  },
)
