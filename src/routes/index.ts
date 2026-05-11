import { Router } from 'express'
import { authRouter } from '@/routes/auth'
import { shopRouter } from '@/routes/shop'
import { shopsRouter } from '@/routes/shops'
import { servicesRouter } from '@/routes/services'
import { photosRouter } from '@/routes/photos'
import { barbersRouter } from '@/routes/barbers'
import { barberPublicRouter } from '@/routes/barber-public'
import { reviewsRouter } from '@/routes/reviews'
import { bookingsRouter } from '@/routes/bookings'
import { queueShopRouter, queueRouter } from '@/routes/queue'
import { dashboardRouter } from '@/routes/dashboard'
import { notificationsRouter } from '@/routes/notifications'
import { onboardingRouter } from '@/routes/onboarding'
import { adminRouter } from '@/routes/admin'
import { userRouter } from '@/routes/user'
import { hairAnalysisRouter } from '@/routes/hair-analysis'
import { contactRouter } from '@/routes/contact'
import { accountRouter } from '@/routes/account'
import { pushRouter } from '@/routes/push'

export const router = Router()

router.use('/auth', authRouter)
router.use('/shop', shopRouter)
router.use('/shops', shopsRouter)
router.use('/shops/:shopId/services', servicesRouter)
router.use('/photos', photosRouter)
router.use('/shops/:shopId/barbers', barbersRouter)
router.use('/barbers', barberPublicRouter)
router.use('/reviews', reviewsRouter)
router.use('/bookings', bookingsRouter)
router.use('/shops/:shopId/queue', queueShopRouter)
router.use('/queue', queueRouter)
router.use('/dashboard', dashboardRouter)
router.use('/notifications', notificationsRouter)
router.use('/onboarding',   onboardingRouter)
router.use('/admin',        adminRouter)
router.use('/user',          userRouter)
router.use('/hair-analysis', hairAnalysisRouter)
router.use('/contact',      contactRouter)
router.use('/account',      accountRouter)
router.use('/push',         pushRouter)
