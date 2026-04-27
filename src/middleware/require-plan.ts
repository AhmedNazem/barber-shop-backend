import { Request, Response, NextFunction } from 'express'
import { prisma } from '@/config/prisma'

export type Plan = 'FREE' | 'STARTER' | 'PRO'

const PLAN_RANK: Record<Plan, number> = {
  FREE: 0,
  STARTER: 1,
  PRO: 2,
}

export function requirePlan(minPlan: Plan) {
  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    if (!req.user?.shopId) {
      res.status(403).json({ error: 'forbidden', message: 'Access denied' })
      return
    }

    const shop = await prisma.shop.findUnique({
      where: { id: req.user.shopId },
      select: { plan: true },
    })

    if (!shop) {
      res.status(403).json({ error: 'forbidden', message: 'Access denied' })
      return
    }

    const shopRank = PLAN_RANK[shop.plan as Plan] ?? 0
    const requiredRank = PLAN_RANK[minPlan]

    if (shopRank < requiredRank) {
      res.status(403).json({
        error: 'plan_required',
        message: 'Plan upgrade required',
        requiredPlan: minPlan,
      })
      return
    }

    next()
  }
}
