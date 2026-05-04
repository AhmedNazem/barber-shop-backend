import { prisma } from '@/config/prisma'
import { AppError } from '@/lib/errors'
import { ShopPlan, BookingMode } from '@prisma/client'

export type FeatureSet = {
  onlineBookings: boolean
  analytics:      boolean
  maxBarbers:     number | null  // null = unlimited
  discounts:      boolean
}

const FEATURES: Record<ShopPlan, FeatureSet> = {
  FREE:    { onlineBookings: false, analytics: false, maxBarbers: 1,    discounts: false },
  STARTER: { onlineBookings: true,  analytics: false, maxBarbers: 2,    discounts: false },
  PRO:     { onlineBookings: true,  analytics: true,  maxBarbers: null, discounts: true  },
}

export const PLAN_MAX_BARBERS: Record<ShopPlan, number | null> = {
  FREE: 1, STARTER: 2, PRO: null,
}

export async function getShopPlan(shopId: string) {
  const shop = await prisma.shop.findUnique({
    where:  { id: shopId },
    select: { plan: true, planExpiresAt: true, planUpdatedAt: true },
  })
  if (!shop) throw new AppError('not_found', 404)
  return {
    plan:          shop.plan,
    planExpiresAt: shop.planExpiresAt,
    planUpdatedAt: shop.planUpdatedAt,
    features:      FEATURES[shop.plan],
  }
}

export async function updateShopPlan(shopId: string, plan: ShopPlan, expiresAt?: string) {
  const shop = await prisma.shop.findUnique({ where: { id: shopId } })
  if (!shop) throw new AppError('not_found', 404)

  await prisma.shop.update({
    where: { id: shopId },
    data:  {
      plan,
      planUpdatedAt: new Date(),
      planExpiresAt: expiresAt ? new Date(expiresAt) : null,
    },
  })
}

export async function updateBookingMode(shopId: string, ownerId: string, mode: BookingMode) {
  const shop = await prisma.shop.findUnique({ where: { id: shopId } })
  if (!shop) throw new AppError('not_found', 404)
  if (shop.ownerId !== ownerId) throw new AppError('forbidden', 403)

  await prisma.shop.update({ where: { id: shopId }, data: { bookingMode: mode } })
}

export function getFeaturesForPlan(plan: ShopPlan): FeatureSet {
  return FEATURES[plan]
}
