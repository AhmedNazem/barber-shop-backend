import multer from 'multer'
import { Request, Response, NextFunction } from 'express'
import { AppError } from '@/lib/errors'

const ALLOWED_MIME = ['image/jpeg', 'image/png', 'image/webp']
const MAX_SIZE = 5 * 1024 * 1024

const _multer = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_SIZE },
  fileFilter: (_req, file, cb) => {
    ALLOWED_MIME.includes(file.mimetype) ? cb(null, true) : cb(new Error('invalid_mime'))
  },
})

export function singleImage(field: string) {
  return (req: Request, res: Response, next: NextFunction) => {
    _multer.single(field)(req, res, (err) => {
      if (err instanceof multer.MulterError) return next(new AppError('file_too_large', 413))
      if (err) return next(new AppError('invalid_mime', 400))
      if (!req.file) return next(new AppError('file_required', 400))
      next()
    })
  }
}

export function multipleImages(field: string, maxCount = 5) {
  return (req: Request, res: Response, next: NextFunction) => {
    _multer.array(field, maxCount)(req, res, (err) => {
      if (err instanceof multer.MulterError) return next(new AppError('file_too_large', 413))
      if (err) return next(new AppError('invalid_mime', 400))
      next()
    })
  }
}

export function brandingImages() {
  return (req: Request, res: Response, next: NextFunction) => {
    _multer.fields([
      { name: 'cover', maxCount: 1 },
      { name: 'logo',  maxCount: 1 },
    ])(req, res, (err) => {
      if (err instanceof multer.MulterError) return next(new AppError('file_too_large', 413))
      if (err) return next(new AppError('invalid_mime', 400))
      next()
    })
  }
}
