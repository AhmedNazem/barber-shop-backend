import { prisma } from '@/config/prisma'
import { AppError } from '@/lib/errors'
import { uploadImageVariants } from '@/lib/s3'

async function assertServiceOwnership(shopId: string, serviceId: string, ownerId: string) {
  const shop = await prisma.shop.findUnique({ where: { id: shopId } })
  if (!shop) throw new AppError('not_found', 404)
  if (shop.ownerId !== ownerId) throw new AppError('forbidden', 403)
  const service = await prisma.service.findFirst({ where: { id: serviceId, shopId } })
  if (!service) throw new AppError('not_found', 404)
}

export async function addServicePhoto(
  shopId: string, serviceId: string, ownerId: string,
  buffer: Buffer, mimeType: string,
) {
  await assertServiceOwnership(shopId, serviceId, ownerId)

  const last = await prisma.servicePhoto.findFirst({
    where: { serviceId }, orderBy: { order: 'desc' },
  })
  const order = (last?.order ?? -1) + 1
  const url = await uploadImageVariants(`services/${serviceId}/photo-${order}`, buffer)
  return prisma.servicePhoto.create({ data: { serviceId, url, order } })
}

export async function deleteServicePhoto(photoId: string, ownerId: string) {
  const photo = await prisma.servicePhoto.findUnique({
    where: { id: photoId },
    include: { service: { include: { shop: true } } },
  })
  if (!photo) throw new AppError('not_found', 404)
  if (photo.service.shop.ownerId !== ownerId) throw new AppError('forbidden', 403)
  await prisma.servicePhoto.delete({ where: { id: photoId } })
}

export async function reorderServicePhotos(
  shopId: string, serviceId: string, ownerId: string, photoIds: string[],
) {
  await assertServiceOwnership(shopId, serviceId, ownerId)
  await Promise.all(
    photoIds.map((id, index) => prisma.servicePhoto.update({ where: { id }, data: { order: index } })),
  )
}
