import { Request, Response, NextFunction } from 'express'
import { ok } from '@/lib/response'
import { getBarberProfile, getBarberAvailability, getBarberPortfolio, getBarberReviews } from '@/services/barber-profile.service'

export async function getBarberProfileHandler(req: Request, res: Response, next: NextFunction) {
  try {
    ok(res, await getBarberProfile(req.params['barberId']!))
  } catch (err) { next(err) }
}

export async function getBarberAvailabilityHandler(req: Request, res: Response, next: NextFunction) {
  try {
    ok(res, await getBarberAvailability(req.params['barberId']!))
  } catch (err) { next(err) }
}

export async function getBarberPortfolioHandler(req: Request, res: Response, next: NextFunction) {
  try {
    ok(res, await getBarberPortfolio(req.params['barberId']!))
  } catch (err) { next(err) }
}

export async function getBarberReviewsHandler(req: Request, res: Response, next: NextFunction) {
  try {
    const page  = Math.max(1, Number(req.query['page'])  || 1)
    const limit = Math.min(50, Number(req.query['limit']) || 10)
    ok(res, await getBarberReviews(req.params['barberId']!, page, limit))
  } catch (err) { next(err) }
}
