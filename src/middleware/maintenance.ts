import { Request, Response, NextFunction } from 'express'
import jwt from 'jsonwebtoken'
import { getMaintenanceMode } from '@/services/platform-config.service'

export async function maintenanceGuard(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const isDown = await getMaintenanceMode()
    if (!isDown) { next(); return }

    // Admins bypass maintenance mode — decode (not verify) the JWT to read role claim
    const header = req.headers['authorization']
    if (header?.startsWith('Bearer ')) {
      const payload = jwt.decode(header.slice(7)) as { role?: string } | null
      if (payload?.role === 'ADMIN') { next(); return }
    }

    res.status(503).json({ error: 'maintenance', message: 'Service is temporarily unavailable' })
  } catch {
    // If maintenance check itself fails (e.g. Redis down), fail open so service stays reachable
    next()
  }
}
