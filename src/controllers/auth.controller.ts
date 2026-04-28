import { Request, Response, NextFunction } from 'express'
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

const REFRESH_COOKIE_PATH = '/api/v1/auth/refresh'
const REFRESH_TTL_MS = 7 * 24 * 60 * 60 * 1000

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
    const { phone, otp, name, shopName, isRegister } = req.body
    const e164 = normalisePhone(phone)
    await verifyOtp(e164, otp)
    const user = await createOrFindUser(e164, { name, shopName, isRegister })
    const { accessToken, refreshToken } = await issueTokens(user)

    res.cookie('refreshToken', refreshToken, {
      httpOnly: true,
      secure: env.NODE_ENV === 'production',
      sameSite: 'lax',
      path: REFRESH_COOKIE_PATH,
      maxAge: REFRESH_TTL_MS,
    })

    ok(res, { accessToken, refreshToken, role: user.role })
  } catch (err) {
    next(err)
  }
}

export async function refreshHandler(req: Request, res: Response, next: NextFunction) {
  try {
    const token: string | undefined = req.cookies?.refreshToken ?? req.body?.refreshToken
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
    const token: string | undefined = req.cookies?.refreshToken ?? req.body?.refreshToken
    if (token) await revokeToken(token)
    res.clearCookie('refreshToken', { path: REFRESH_COOKIE_PATH })
    ok(res, { ok: true })
  } catch (err) {
    next(err)
  }
}
