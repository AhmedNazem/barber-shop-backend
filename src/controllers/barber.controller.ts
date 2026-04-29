import { Request, Response, NextFunction } from 'express'
import { ok } from '@/lib/response'
import { listBarbers, createBarber, updateBarber, deactivateBarber, setBarberSchedule } from '@/services/barber.service'

export async function listBarbersHandler(req: Request, res: Response, next: NextFunction) {
  try {
    ok(res, await listBarbers(req.params['shopId']!))
  } catch (err) { next(err) }
}

export async function createBarberHandler(req: Request, res: Response, next: NextFunction) {
  try {
    const result = await createBarber(req.params['shopId']!, req.user!.id, req.body)
    res.status(201).json({ data: result })
  } catch (err) { next(err) }
}

export async function updateBarberHandler(req: Request, res: Response, next: NextFunction) {
  try {
    ok(res, await updateBarber(req.params['shopId']!, req.params['barberId']!, req.user!.id, req.body))
  } catch (err) { next(err) }
}

export async function deactivateBarberHandler(req: Request, res: Response, next: NextFunction) {
  try {
    ok(res, await deactivateBarber(req.params['shopId']!, req.params['barberId']!, req.user!.id))
  } catch (err) { next(err) }
}

export async function setScheduleHandler(req: Request, res: Response, next: NextFunction) {
  try {
    ok(res, await setBarberSchedule(req.params['shopId']!, req.params['barberId']!, req.user!.id, req.body))
  } catch (err) { next(err) }
}
