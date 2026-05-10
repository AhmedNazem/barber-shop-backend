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
