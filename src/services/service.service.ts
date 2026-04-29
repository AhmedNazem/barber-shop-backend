import { prisma } from '@/config/prisma'
import { AppError } from '@/lib/errors'

async function assertOwnership(shopId: string, ownerId: string) {
  const shop = await prisma.shop.findUnique({ where: { id: shopId } })
  if (!shop) throw new AppError('not_found', 404)
  if (shop.ownerId !== ownerId) throw new AppError('forbidden', 403)
}

export async function listServices(shopId: string) {
  return prisma.service.findMany({
    where: { shopId, isActive: true },
    include: { photos: { orderBy: { order: 'asc' } } },
    orderBy: { nameEn: 'asc' },
  })
}

export async function createService(
  shopId: string,
  ownerId: string,
  data: { nameEn: string; nameAr: string; price: number; durationMin: number; category: string },
) {
  await assertOwnership(shopId, ownerId)
  return prisma.service.create({ data: { shopId, ...data } })
}

export async function updateService(
  shopId: string,
  serviceId: string,
  ownerId: string,
  data: Partial<{ nameEn: string; nameAr: string; price: number; durationMin: number; category: string; isActive: boolean }>,
) {
  await assertOwnership(shopId, ownerId)
  const service = await prisma.service.findFirst({ where: { id: serviceId, shopId } })
  if (!service) throw new AppError('not_found', 404)
  return prisma.service.update({ where: { id: serviceId }, data })
}

export async function deleteService(shopId: string, serviceId: string, ownerId: string) {
  await assertOwnership(shopId, ownerId)
  const service = await prisma.service.findFirst({ where: { id: serviceId, shopId } })
  if (!service) throw new AppError('not_found', 404)

  const upcoming = await prisma.bookingService.count({
    where: {
      serviceId,
      booking: { status: { in: ['UPCOMING', 'CONFIRMED'] } },
    },
  })
  if (upcoming > 0) throw new AppError('conflict', 409)

  await prisma.service.delete({ where: { id: serviceId } })
}
