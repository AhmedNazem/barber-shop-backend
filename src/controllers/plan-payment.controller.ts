import { Request, Response } from 'express'
import { z } from 'zod'
import {
  requestPlanPayment,
  listPendingPlanPayments,
  confirmPlanPayment,
  rejectPlanPayment,
  listShopPlanPayments,
} from '@/services/plan-payment.service'

const requestSchema = z.object({
  plan:          z.enum(['STARTER', 'PRO']),
  months:        z.number().int().min(1).max(12).default(1),
  method:        z.string().min(1).max(50),
  referenceNote: z.string().max(200).optional(),
})

const rejectSchema = z.object({
  rejectReason: z.string().min(1).max(300),
})

export async function handleRequestPlanPayment(req: Request, res: Response) {
  const body = requestSchema.parse(req.body)
  const payment = await requestPlanPayment(
    req.user!.id,
    body.plan,
    body.months,
    body.method,
    body.referenceNote,
  )
  res.status(201).json({ data: payment })
}

export async function handleListPendingPlanPayments(_req: Request, res: Response) {
  const payments = await listPendingPlanPayments()
  res.json({ data: payments })
}

export async function handleConfirmPlanPayment(req: Request, res: Response) {
  await confirmPlanPayment(req.params['id']!, req.user!.id)
  res.json({ ok: true })
}

export async function handleRejectPlanPayment(req: Request, res: Response) {
  const { rejectReason } = rejectSchema.parse(req.body)
  await rejectPlanPayment(req.params['id']!, req.user!.id, rejectReason)
  res.json({ ok: true })
}

export async function handleListShopPlanPayments(req: Request, res: Response) {
  const payments = await listShopPlanPayments(req.user!.id)
  res.json({ data: payments })
}
