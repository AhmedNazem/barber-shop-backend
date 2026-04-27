import { Request, Response, NextFunction } from 'express'
import { prisma } from '@/config/prisma'

const STATUS_ERROR: Record<string, string> = {
  PENDING:   'shop_pending',
  REJECTED:  'shop_rejected',
  SUSPENDED: 'shop_suspended',
}

export function requireShopStatus() {
  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    if (!req.user?.shopId) {
      res.status(403).json({ error: 'forbidden', message: 'Access denied' })
      return
    }

    const shop = await prisma.shop.findUnique({
      where: { id: req.user.shopId },
      select: { status: true },
    })

    if (!shop) {
      res.status(403).json({ error: 'forbidden', message: 'Access denied' })
      return
    }

    if (shop.status !== 'APPROVED') {
      const error = STATUS_ERROR[shop.status] ?? 'forbidden'
      res.status(403).json({ error, message: error })
      return
    }

    next()
  }
}
