import { Request, Response, NextFunction } from 'express'
import { ok } from '@/lib/response'
import { env } from '@/config/env'
import { generateInvite, getInviteInfo, acceptInvite } from '@/services/invite.service'

const REFRESH_COOKIE_PATH = '/api/v1/auth'
const REFRESH_TTL_MS = 7 * 24 * 60 * 60 * 1000

export async function generateInviteHandler(req: Request, res: Response, next: NextFunction) {
  try {
    const { nameEn, nameAr } = req.body as { nameEn: string; nameAr: string }
    const result = await generateInvite(req.user!.id, nameEn, nameAr)
    ok(res, result)
  } catch (err) {
    next(err)
  }
}

export async function getInviteInfoHandler(req: Request, res: Response, next: NextFunction) {
  try {
    const { code } = req.query as { code: string }
    const result = await getInviteInfo(code)
    ok(res, result)
  } catch (err) {
    next(err)
  }
}

export async function acceptInviteHandler(req: Request, res: Response, next: NextFunction) {
  try {
    const { code, phone, otp } = req.body as { code: string; phone: string; otp: string }
    const { accessToken, refreshToken, role } = await acceptInvite(code, phone, otp)

    res.cookie('refreshToken', refreshToken, {
      httpOnly: true,
      secure: env.NODE_ENV === 'production',
      sameSite: 'lax',
      path: REFRESH_COOKIE_PATH,
      maxAge: REFRESH_TTL_MS,
    })

    ok(res, { accessToken, role })
  } catch (err) {
    next(err)
  }
}
