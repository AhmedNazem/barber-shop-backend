import { prisma } from '@/config/prisma'
import { AppError } from '@/lib/errors'

export async function getShopStatus(ownerId: string) {
  const shop = await prisma.shop.findFirst({ where: { ownerId } })
  if (!shop) throw new AppError('not_found', 404)

  return {
    status: shop.status,
    ...(shop.rejectionReason && { rejectionReason: shop.rejectionReason }),
  }
}
