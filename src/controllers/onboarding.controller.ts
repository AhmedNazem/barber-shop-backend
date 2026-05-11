import { Request, Response, NextFunction } from 'express'
import { ok } from '@/lib/response'
import { uploadImageVariants } from '@/lib/s3'
import { prisma } from '@/config/prisma'
import { AppError } from '@/lib/errors'
import { onboardBasics, onboardBranding, onboardServices, onboardHours, onboardSubmit } from '@/services/onboarding.service'

export async function onboardBasicsHandler(req: Request, res: Response, next: NextFunction) {
  try {
    ok(res, await onboardBasics(req.user!.id, req.body))
  } catch (err) { next(err) }
}

export async function onboardBrandingHandler(req: Request, res: Response, next: NextFunction) {
  try {
    const files = (req.files ?? {}) as Record<string, Express.Multer.File[]>
    const ownerId = req.user!.id

    // JWT shopId may be stale if the user hasn't re-authenticated after step 1 — resolve from DB
    const shop = await prisma.shop.findFirst({ where: { ownerId } })
    if (!shop) throw new AppError('not_found', 404)

    const coverFile = files['cover']?.[0]
    const logoFile  = files['logo']?.[0]

    const coverUrl = coverFile
      ? await uploadImageVariants(`shops/${shop.id}/cover`, coverFile.buffer)
      : undefined
    const logoUrl = logoFile
      ? await uploadImageVariants(`shops/${shop.id}/logo`, logoFile.buffer)
      : undefined

    ok(res, await onboardBranding(ownerId, coverUrl, logoUrl))
  } catch (err) { next(err) }
}

export async function onboardServicesHandler(req: Request, res: Response, next: NextFunction) {
  try {
    ok(res, await onboardServices(req.user!.id, req.body.services))
  } catch (err) { next(err) }
}

export async function onboardHoursHandler(req: Request, res: Response, next: NextFunction) {
  try {
    ok(res, await onboardHours(req.user!.id, req.body))
  } catch (err) { next(err) }
}

export async function onboardSubmitHandler(req: Request, res: Response, next: NextFunction) {
  try {
    await onboardSubmit(req.user!.id)
    ok(res, { ok: true })
  } catch (err) { next(err) }
}
