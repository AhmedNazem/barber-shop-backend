import { Request, Response, NextFunction } from 'express'
import { prisma } from '@/config/prisma'
import { getLoyalty } from '@/services/loyalty.service'
import { getReliability } from '@/services/reliability.service'

export async function getSavedShopsHandler(req: Request, res: Response, next: NextFunction) {
  try {
    const userId = req.user!.id
    const saved = await prisma.savedShop.findMany({
      where:   { userId },
      orderBy: { savedAt: 'desc' },
      take:    50,
    })
    res.json({ data: saved })
  } catch (err) { next(err) }
}

export async function saveShopHandler(req: Request, res: Response, next: NextFunction) {
  try {
    const userId = req.user!.id
    const { shopId } = req.params as { shopId: string }

    await prisma.savedShop.upsert({
      where:  { userId_shopId: { userId, shopId } },
      update: {},
      create: { userId, shopId },
    })

    res.status(201).json({ data: { saved: true } })
  } catch (err) { next(err) }
}

export async function unsaveShopHandler(req: Request, res: Response, next: NextFunction) {
  try {
    const userId = req.user!.id
    const { shopId } = req.params as { shopId: string }

    await prisma.savedShop.deleteMany({
      where: { userId, shopId },
    })

    res.status(204).send()
  } catch (err) { next(err) }
}

export async function getLoyaltyHandler(req: Request, res: Response, next: NextFunction) {
  try {
    const data = await getLoyalty(req.user!.id)
    const isVip = !!(await prisma.user.findUnique({
      where: { id: req.user!.id },
      select: { isVip: true },
    }))?.isVip
    res.json({ data: { points: data.points, tier: data.tier, isVip } })
  } catch (err) { next(err) }
}

export async function getReliabilityHandler(req: Request, res: Response, next: NextFunction) {
  try {
    const data = await getReliability(req.user!.id)
    res.json({ data })
  } catch (err) { next(err) }
}

export async function exportAccountHandler(req: Request, res: Response, next: NextFunction) {
  try {
    const userId = req.user!.id

    const [profile, bookings, reviews, loyaltyHistory, hairAnalyses, savedShops, reliability] = await Promise.all([
      prisma.user.findUnique({
        where: { id: userId },
        select: {
          id: true, phone: true, name: true, role: true,
          shopId: true, isVip: true, vipGrantedAt: true,
          suspended: true, createdAt: true, updatedAt: true,
        },
      }),
      prisma.booking.findMany({
        where: { customerId: userId },
        orderBy: { createdAt: 'desc' },
      }),
      prisma.review.findMany({
        where: { customerId: userId },
        orderBy: { createdAt: 'desc' },
      }),
      prisma.loyaltyTransaction.findMany({
        where: { userId },
        orderBy: { createdAt: 'desc' },
      }),
      prisma.hairAnalysis.findMany({
        where: { userId },
        orderBy: { createdAt: 'desc' },
      }),
      prisma.savedShop.findMany({
        where: { userId },
        orderBy: { savedAt: 'desc' },
      }),
      prisma.reliabilityRecord.findUnique({
        where: { userId },
      }),
    ])

    const payload = {
      exportedAt: new Date().toISOString(),
      profile,
      reliability,
      bookings,
      reviews,
      loyaltyHistory,
      hairAnalyses,
      savedShops,
    }

    res.setHeader('Content-Type', 'application/json')
    res.setHeader('Content-Disposition', 'attachment; filename="my-data.json"')
    res.send(JSON.stringify(payload, null, 2))
  } catch (err) { next(err) }
}
