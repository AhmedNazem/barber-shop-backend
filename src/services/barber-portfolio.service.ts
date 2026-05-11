import { prisma } from '@/config/prisma'
import { AppError } from '@/lib/errors'
import { uploadImageVariants } from '@/lib/s3'

async function assertBarberOwnership(shopId: string, barberId: string, ownerId: string) {
  const shop = await prisma.shop.findUnique({ where: { id: shopId } })
  if (!shop) throw new AppError('not_found', 404)
  if (shop.ownerId !== ownerId) throw new AppError('forbidden', 403)
  const barber = await prisma.barber.findFirst({ where: { id: barberId, shopId } })
  if (!barber) throw new AppError('not_found', 404)
}

export async function addPortfolioPhoto(
  shopId: string, barberId: string, ownerId: string,
  buffer: Buffer, mimeType: string,
) {
  await assertBarberOwnership(shopId, barberId, ownerId)
  const last = await prisma.barberPortfolio.findFirst({
    where: { barberId }, orderBy: { order: 'desc' },
  })
  const order = (last?.order ?? -1) + 1
  const url = await uploadImageVariants(`barbers/${barberId}/portfolio-${order}`, buffer)
  return prisma.barberPortfolio.create({ data: { barberId, photoUrl: url, order } })
}

export async function deletePortfolioPhoto(photoId: string, ownerId: string) {
  const photo = await prisma.barberPortfolio.findUnique({
    where: { id: photoId },
    include: { barber: { include: { shop: true } } },
  })
  if (!photo) throw new AppError('not_found', 404)
  if (photo.barber.shop.ownerId !== ownerId) throw new AppError('forbidden', 403)
  await prisma.barberPortfolio.delete({ where: { id: photoId } })
}

export async function reorderPortfolioPhotos(
  shopId: string, barberId: string, ownerId: string, photoIds: string[],
) {
  await assertBarberOwnership(shopId, barberId, ownerId)
  await Promise.all(
    photoIds.map((id, index) => prisma.barberPortfolio.update({ where: { id }, data: { order: index } })),
  )
}
