import { Request, Response, NextFunction } from 'express'

// Stub — expanded in S1.8
export function errorHandler(
  err: Error & { status?: number },
  _req: Request,
  res: Response,
  _next: NextFunction,
) {
  const status = err.status ?? 500
  res.status(status).json({ error: 'internal_error', message: 'Something went wrong' })
}
