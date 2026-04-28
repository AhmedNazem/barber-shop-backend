import { Request, Response, NextFunction } from 'express'
import { ok } from '@/lib/response'
import { generateInvite, getInviteInfo, acceptInvite } from '@/services/invite.service'

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
    const result = await acceptInvite(code, phone, otp)
    ok(res, result)
  } catch (err) {
    next(err)
  }
}
