import { Router } from 'express'
import { getBarberProfileHandler, getBarberAvailabilityHandler, getBarberPortfolioHandler, getBarberReviewsHandler } from '@/controllers/barber-profile.controller'

export const barberPublicRouter = Router()

barberPublicRouter.get('/:barberId',              getBarberProfileHandler)
barberPublicRouter.get('/:barberId/availability', getBarberAvailabilityHandler)
barberPublicRouter.get('/:barberId/portfolio',    getBarberPortfolioHandler)
barberPublicRouter.get('/:barberId/reviews',      getBarberReviewsHandler)
