import { Request, Response, NextFunction } from 'express'
import { ok } from '@/lib/response'
import { addPortfolioPhoto, deletePortfolioPhoto, reorderPortfolioPhotos } from '@/services/barber-portfolio.service'

export async function uploadPortfolioPhotoHandler(req: Request, res: Response, next: NextFunction) {
  try {
    const { shopId, barberId } = req.params
    const result = await addPortfolioPhoto(shopId!, barberId!, req.user!.id, req.file!.buffer, req.file!.mimetype)
    res.status(201).json({ data: result })
  } catch (err) { next(err) }
}

export async function deletePortfolioPhotoHandler(req: Request, res: Response, next: NextFunction) {
  try {
    await deletePortfolioPhoto(req.params['photoId']!, req.user!.id)
    ok(res, null)
  } catch (err) { next(err) }
}

export async function reorderPortfolioPhotosHandler(req: Request, res: Response, next: NextFunction) {
  try {
    const { shopId, barberId } = req.params
    await reorderPortfolioPhotos(shopId!, barberId!, req.user!.id, req.body.photoIds)
    ok(res, null)
  } catch (err) { next(err) }
}
