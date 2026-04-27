import { Request, Response, NextFunction } from 'express'

export function requireOwnership(getShopId: (req: Request) => string | undefined) {
  return (req: Request, res: Response, next: NextFunction): void => {
    if (!req.user) {
      res.status(401).json({ error: 'unauthorized', message: 'Authentication required' })
      return
    }

    // Admins bypass ownership checks
    if (req.user.role === 'ADMIN') {
      next()
      return
    }

    const shopId = getShopId(req)

    if (!shopId || req.user.shopId !== shopId) {
      res.status(403).json({ error: 'forbidden', message: 'Access denied' })
      return
    }

    next()
  }
}
