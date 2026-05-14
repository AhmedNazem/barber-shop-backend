import { Request, Response, NextFunction } from 'express'
import { UserRole } from '@prisma/client'
import { AppError } from '@/lib/errors'
import { ok } from '@/lib/response'
import { env } from '@/config/env'
import { normalisePhone } from '@/lib/sms'
import { requestOtp, verifyOtp } from '@/services/otp.service'
import {
  createOrFindUser,
  issueTokens,
  rotateAccessToken,
  revokeToken,
  getSession,
} from '@/services/auth.service'

const REFRESH_COOKIE_PATH = '/api/v1/auth'

export async function requestOtpHandler(req: Request, res: Response, next: NextFunction) {
  try {
    await requestOtp(req.body.phone)
    ok(res, { ok: true })
  } catch (err) {
    next(err)
  }
}

export async function verifyOtpHandler(req: Request, res: Response, next: NextFunction) {
  try {
    const { phone, otp, name, shopName, isRegister, referralCode, rememberMe } = req.body
    const e164 = normalisePhone(phone)
    await verifyOtp(e164, otp)
    const user = await createOrFindUser(e164, { name, shopName, isRegister, referralCode })

    // User.shopId is the barber's assigned shop — not set for SHOP_OWNERs.
    // Look up their owned shop so the JWT carries the correct shopId.
    let shopId: string | null = user.shopId
    if (user.role === UserRole.SHOP_OWNER) {
      const { prisma } = await import('@/config/prisma')
      const shop = await prisma.shop.findFirst({ where: { ownerId: user.id }, select: { id: true } })
      shopId = shop?.id ?? null
    }
    const { accessToken, refreshToken, ttlMs } = await issueTokens({ ...user, shopId }, rememberMe ?? false)

    res.cookie('refreshToken', refreshToken, {
      httpOnly: true,
      secure: env.NODE_ENV === 'production',
      sameSite: 'lax',
      path: REFRESH_COOKIE_PATH,
      maxAge: ttlMs,
    })

    ok(res, { accessToken, role: user.role })
  } catch (err) {
    next(err)
  }
}

export async function refreshHandler(req: Request, res: Response, next: NextFunction) {
  try {
    const token: string | undefined = req.cookies?.refreshToken
    if (!token) throw new AppError('unauthorized', 401)
    const accessToken = await rotateAccessToken(token)
    ok(res, { accessToken })
  } catch (err) {
    next(err)
  }
}

export async function meHandler(req: Request, res: Response, next: NextFunction) {
  try {
    const session = await getSession(req.user!.id)
    ok(res, session)
  } catch (err) {
    next(err)
  }
}

export async function logoutHandler(req: Request, res: Response, next: NextFunction) {
  try {
    const token: string | undefined = req.cookies?.refreshToken
    if (token) await revokeToken(token)
    res.clearCookie('refreshToken', { path: REFRESH_COOKIE_PATH })
    ok(res, { ok: true })
  } catch (err) {
    next(err)
  }
}
