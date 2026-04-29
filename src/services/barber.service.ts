import { prisma } from '@/config/prisma'
import { AppError } from '@/lib/errors'

async function assertOwnership(shopId: string, ownerId: string) {
  const shop = await prisma.shop.findUnique({ where: { id: shopId } })
  if (!shop) throw new AppError('not_found', 404)
  if (shop.ownerId !== ownerId) throw new AppError('forbidden', 403)
}

export async function listBarbers(shopId: string) {
  return prisma.barber.findMany({
    where: { shopId, isActive: true },
    orderBy: { nameEn: 'asc' },
  })
}

export async function createBarber(
  shopId: string,
  ownerId: string,
  data: { nameEn: string; nameAr: string; bio?: string; bioAr?: string; specialties?: string[]; experienceYears?: number },
) {
  await assertOwnership(shopId, ownerId)
  return prisma.barber.create({ data: { shopId, ...data } })
}

export async function updateBarber(
  shopId: string,
  barberId: string,
  ownerId: string,
  data: Partial<{ nameEn: string; nameAr: string; bio: string; bioAr: string; specialties: string[]; experienceYears: number }>,
) {
  await assertOwnership(shopId, ownerId)
  const barber = await prisma.barber.findFirst({ where: { id: barberId, shopId } })
  if (!barber) throw new AppError('not_found', 404)
  return prisma.barber.update({ where: { id: barberId }, data })
}

export async function deactivateBarber(shopId: string, barberId: string, ownerId: string) {
  await assertOwnership(shopId, ownerId)
  const barber = await prisma.barber.findFirst({ where: { id: barberId, shopId } })
  if (!barber) throw new AppError('not_found', 404)
  return prisma.barber.update({ where: { id: barberId }, data: { isActive: false } })
}

type ScheduleEntry = { dayOfWeek: number; startTime: string; endTime: string; isAvailable: boolean }

export async function setBarberSchedule(shopId: string, barberId: string, ownerId: string, entries: ScheduleEntry[]) {
  await assertOwnership(shopId, ownerId)
  const barber = await prisma.barber.findFirst({ where: { id: barberId, shopId } })
  if (!barber) throw new AppError('not_found', 404)
  return prisma.$transaction([
    prisma.barberSchedule.deleteMany({ where: { barberId } }),
    prisma.barberSchedule.createMany({ data: entries.map(e => ({ ...e, barberId })) }),
  ])
}
