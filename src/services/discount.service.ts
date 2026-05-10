import { prisma } from '@/config/prisma'
import { AppError } from '@/lib/errors'
import { ShopPlan } from '@prisma/client'

type CreateDiscountInput = {
  pct:      number
  maxUsers: number
  expiresAt: string
}

export async function getDiscount(shopId: string) {
  const discount = await prisma.shopDiscount.findUnique({ where: { shopId } })
  if (!discount) return null

  const now = new Date()
  if (discount.expiresAt <= now || discount.slotsClaimed >= discount.maxUsers) return null

  return {
    pct:          discount.pct,
    maxUsers:     discount.maxUsers,
    slotsClaimed: discount.slotsClaimed,
    expiresAt:    discount.expiresAt,
  }
}

export async function createDiscount(shopId: string, ownerId: string, input: CreateDiscountInput) {
  const shop = await prisma.shop.findUnique({ where: { id: shopId } })
  if (!shop) throw new AppError('not_found', 404)
  if (shop.ownerId !== ownerId) throw new AppError('forbidden', 403)
  if (shop.plan === ShopPlan.FREE) throw new AppError('plan_required', 403)

  const expiresAt = new Date(input.expiresAt)
  if (isNaN(expiresAt.getTime()) || expiresAt <= new Date()) {
    throw new AppError('invalid_date', 400)
  }

  return prisma.shopDiscount.upsert({
    where:  { shopId },
    update: { pct: input.pct, maxUsers: input.maxUsers, expiresAt, slotsClaimed: 0 },
    create: { shopId, pct: input.pct, maxUsers: input.maxUsers, expiresAt },
  })
}

export async function deleteDiscount(shopId: string, ownerId: string) {
  const shop = await prisma.shop.findUnique({ where: { id: shopId } })
  if (!shop) throw new AppError('not_found', 404)
  if (shop.ownerId !== ownerId) throw new AppError('forbidden', 403)

  const existing = await prisma.shopDiscount.findUnique({ where: { shopId } })
  if (!existing) throw new AppError('not_found', 404)

  await prisma.shopDiscount.delete({ where: { shopId } })
}
