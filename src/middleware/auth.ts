import { Request, Response, NextFunction } from 'express'
import { TokenExpiredError } from 'jsonwebtoken'
import { verifyAccess } from '@/lib/jwt'

export function optionalAuth(req: Request, _res: Response, next: NextFunction): void {
  const header = req.headers['authorization']
  if (header?.startsWith('Bearer ')) {
    try { req.user = verifyAccess(header.slice(7)) } catch { /* ignore */ }
  }
  next()
}

export function authenticate(req: Request, res: Response, next: NextFunction): void {
  const header = req.headers['authorization']

  if (!header?.startsWith('Bearer ')) {
    res.status(401).json({ error: 'unauthorized', message: 'Authentication required' })
    return
  }

  const token = header.slice(7)

  try {
    req.user = verifyAccess(token)
    next()
  } catch (err) {
    if (err instanceof TokenExpiredError) {
      res.status(401).json({ error: 'token_expired', message: 'Token has expired' })
      return
    }
    res.status(401).json({ error: 'unauthorized', message: 'Invalid token' })
  }
}
