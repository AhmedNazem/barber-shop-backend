import { Request, Response, NextFunction } from 'express'
import jwt from 'jsonwebtoken'
import { getMaintenanceMode } from '@/services/platform-config.service'
import { env } from '@/config/env'

export async function maintenanceGuard(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const isDown = await getMaintenanceMode()
    if (!isDown) { next(); return }

    // Admins bypass maintenance mode — verify the JWT to read role claim securely
    const header = req.headers['authorization']
    if (header?.startsWith('Bearer ')) {
      try {
        const payload = jwt.verify(header.slice(7), env.JWT_SECRET) as { role?: string }
        if (payload?.role === 'ADMIN') { next(); return }
      } catch (err) {
        // Invalid token, fall through to 503
      }
    }

    res.status(503).json({ error: 'maintenance', message: 'Service is temporarily unavailable' })
  } catch {
    // If maintenance check itself fails (e.g. Redis down), fail open so service stays reachable
    next()
  }
}
