import jwt from 'jsonwebtoken'

export type JwtPayload = {
  id: string
  role: string
  shopId?: string
}

function accessSecret(): string {
  const s = process.env['JWT_SECRET']
  if (!s) throw new Error('JWT_SECRET is not set')
  return s
}

function refreshSecret(): string {
  const s = process.env['JWT_REFRESH_SECRET']
  if (!s) throw new Error('JWT_REFRESH_SECRET is not set')
  return s
}

export function signAccess(payload: JwtPayload): string {
  return jwt.sign(payload, accessSecret(), { expiresIn: '15m' })
}

export function signRefresh(payload: JwtPayload): string {
  return jwt.sign(payload, refreshSecret(), { expiresIn: '7d' })
}

export function verifyAccess(token: string): JwtPayload {
  return jwt.verify(token, accessSecret()) as JwtPayload
}

export function verifyRefresh(token: string): JwtPayload {
  return jwt.verify(token, refreshSecret()) as JwtPayload
}
