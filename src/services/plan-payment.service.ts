import { randomBytes } from 'crypto'
import { prisma } from '@/config/prisma'
import { AppError } from '@/lib/errors'
import { ShopPlan } from '@prisma/client'

const PLAN_PRICES: Record<ShopPlan, number> = {
  FREE:    0,
  STARTER: 10_000,
  PRO:     25_000,
}

function generateRefCode(): string {
  return 'SUB-' + randomBytes(3).toString('hex').toUpperCase()
}

export async function requestPlanPayment(
  ownerId: string,
  plan: ShopPlan,
  months: number,
  method: string,
  referenceNote?: string,
) {
  const shop = await prisma.shop.findFirst({ where: { ownerId } })
  if (!shop) throw new AppError('not_found', 404)
  if (plan === 'FREE') throw new AppError('invalid_plan', 400)
  if (months < 1 || months > 12) throw new AppError('invalid_months', 400)

  const pricePerMonth = PLAN_PRICES[plan]
  const amount = pricePerMonth * months

  return prisma.planPayment.create({
    data: {
      shopId: shop.id,
      plan,
      months,
      amount,
      refCode: generateRefCode(),
      method,
      referenceNote,
    },
  })
}

export async function listPendingPlanPayments() {
  return prisma.planPayment.findMany({
    where:   { status: 'AWAITING_CONFIRMATION' },
    include: { shop: { select: { nameEn: true, nameAr: true, ownerId: true } } },
    orderBy: { createdAt: 'asc' },
    take:    100,
  })
}

export async function confirmPlanPayment(paymentId: string, adminId: string) {
  const payment = await prisma.planPayment.findUnique({
    where:   { id: paymentId },
    include: { shop: true },
  })
  if (!payment) throw new AppError('not_found', 404)
  if (payment.status !== 'AWAITING_CONFIRMATION') throw new AppError('already_resolved', 422)

  const now = new Date()
  const currentExpiry = payment.shop.planExpiresAt && payment.shop.planExpiresAt > now
    ? payment.shop.planExpiresAt
    : now
  const newExpiry = new Date(currentExpiry.getTime() + payment.months * 30 * 24 * 60 * 60 * 1000)

  await prisma.$transaction([
    prisma.planPayment.update({
      where: { id: paymentId },
      data:  { status: 'CONFIRMED', reviewedBy: adminId, reviewedAt: now },
    }),
    prisma.shop.update({
      where: { id: payment.shopId },
      data:  { plan: payment.plan, planUpdatedAt: now, planExpiresAt: newExpiry },
    }),
  ])
}

export async function rejectPlanPayment(
  paymentId: string,
  adminId: string,
  rejectReason: string,
) {
  const payment = await prisma.planPayment.findUnique({ where: { id: paymentId } })
  if (!payment) throw new AppError('not_found', 404)
  if (payment.status !== 'AWAITING_CONFIRMATION') throw new AppError('already_resolved', 422)

  await prisma.planPayment.update({
    where: { id: paymentId },
    data:  { status: 'REJECTED', reviewedBy: adminId, reviewedAt: new Date(), rejectReason },
  })
}

export async function listShopPlanPayments(ownerId: string) {
  const shop = await prisma.shop.findFirst({ where: { ownerId } })
  if (!shop) throw new AppError('not_found', 404)

  return prisma.planPayment.findMany({
    where:   { shopId: shop.id },
    orderBy: { createdAt: 'desc' },
    take:    20,
  })
}
