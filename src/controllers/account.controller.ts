import { Request, Response, NextFunction } from 'express'
import { prisma } from '@/config/prisma'

export async function getSavedShopsHandler(req: Request, res: Response, next: NextFunction) {
  try {
    const userId = req.user!.id
    const saved = await prisma.savedShop.findMany({
      where:   { userId },
      orderBy: { savedAt: 'desc' },
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
