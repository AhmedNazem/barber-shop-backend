import { Response } from 'express'

export interface PaginationMeta {
  total: number
  limit: number
  offset: number
}

export function ok<T>(res: Response, data: T, status = 200): void {
  res.status(status).json({ data })
}

export function paginated<T>(
  res: Response,
  data: T[],
  meta: PaginationMeta,
): void {
  res.status(200).json({ data, meta })
}
