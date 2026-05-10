import type { Request, Response, NextFunction } from 'express'
import {
  submitPaymentProof,
  confirmPayment,
  rejectPayment,
  listPendingPayments,
} from '@/services/manual-payment.service'

export async function submitProofHandler(req: Request, res: Response, next: NextFunction) {
  try {
    await submitPaymentProof(req.params.id, req.user!.id, req.body.referenceNote ?? '')
    res.status(204).end()
  } catch (err) {
    next(err)
  }
}

export async function confirmPaymentHandler(req: Request, res: Response, next: NextFunction) {
  try {
    await confirmPayment(req.params.id, req.user!.id)
    res.status(204).end()
  } catch (err) {
    next(err)
  }
}

export async function rejectPaymentHandler(req: Request, res: Response, next: NextFunction) {
  try {
    await rejectPayment(req.params.id, req.user!.id, req.body.reason)
    res.status(204).end()
  } catch (err) {
    next(err)
  }
}

export async function listPendingPaymentsHandler(req: Request, res: Response, next: NextFunction) {
  try {
    const payments = await listPendingPayments()
    res.json({ payments })
  } catch (err) {
    next(err)
  }
}
