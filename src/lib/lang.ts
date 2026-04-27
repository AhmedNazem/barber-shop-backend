import { Request } from 'express'

export type Lang = 'ar' | 'en'

export function getLang(req: Request): Lang {
  const param = req.query['lang']
  if (param === 'ar' || param === 'en') return param

  const header = req.headers['accept-language'] ?? ''
  return header.startsWith('ar') ? 'ar' : 'en'
}
