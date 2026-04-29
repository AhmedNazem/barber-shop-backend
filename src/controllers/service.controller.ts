import { Request, Response, NextFunction } from 'express'
import { ok } from '@/lib/response'
import { listServices, createService, updateService, deleteService } from '@/services/service.service'

export async function listServicesHandler(req: Request, res: Response, next: NextFunction) {
  try {
    ok(res, await listServices(req.params['shopId']!))
  } catch (err) { next(err) }
}

export async function createServiceHandler(req: Request, res: Response, next: NextFunction) {
  try {
    const result = await createService(req.params['shopId']!, req.user!.id, req.body)
    res.status(201).json({ data: result })
  } catch (err) { next(err) }
}

export async function updateServiceHandler(req: Request, res: Response, next: NextFunction) {
  try {
    ok(res, await updateService(req.params['shopId']!, req.params['serviceId']!, req.user!.id, req.body))
  } catch (err) { next(err) }
}

export async function deleteServiceHandler(req: Request, res: Response, next: NextFunction) {
  try {
    await deleteService(req.params['shopId']!, req.params['serviceId']!, req.user!.id)
    ok(res, { ok: true })
  } catch (err) { next(err) }
}
