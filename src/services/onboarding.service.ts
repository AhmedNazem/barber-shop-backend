import { prisma } from '@/config/prisma'
import { AppError } from '@/lib/errors'
import { createNotification } from '@/services/notification.service'

const DAY_MAP: Record<string, number> = {
  mon: 1, tue: 2, wed: 3, thu: 4, fri: 5, sat: 6, sun: 0,
}

type DayInput = { closed: boolean; open: string; close: string }

export async function onboardBasics(
  ownerId: string,
  data: {
    nameEn: string; nameAr: string; address: string; city: string
    neighborhood: string; neighborhoodAr: string; phone: string
    lat: number; lng: number
  },
) {
  const existing = await prisma.shop.findFirst({ where: { ownerId } })

  let shop
  if (existing) {
    if (existing.status !== 'REJECTED') throw new AppError('conflict', 409)
    shop = await prisma.shop.update({ where: { id: existing.id }, data })
  } else {
    shop = await prisma.shop.create({ data: { ownerId, ...data } })
  }

  await prisma.user.update({ where: { id: ownerId }, data: { shopId: shop.id } })

  return { shopId: shop.id }
}

export async function onboardBranding(ownerId: string, coverUrl?: string, logoUrl?: string) {
  const shop = await prisma.shop.findFirst({ where: { ownerId } })
  if (!shop) throw new AppError('not_found', 404)

  return prisma.shop.update({
    where: { id: shop.id },
    data: {
      ...(coverUrl !== undefined ? { coverUrl } : {}),
      ...(logoUrl  !== undefined ? { logoUrl }  : {}),
    },
  })
}

export async function onboardServices(
  ownerId: string,
  services: Array<{ nameEn: string; nameAr: string; category: string; price: number; durationMin: number }>,
) {
  const shop = await prisma.shop.findFirst({ where: { ownerId } })
  if (!shop) throw new AppError('not_found', 404)

  return prisma.$transaction(async (tx) => {
    await tx.service.deleteMany({ where: { shopId: shop.id } })
    await tx.service.createMany({ data: services.map(s => ({ ...s, shopId: shop.id })) })
    return tx.service.findMany({ where: { shopId: shop.id } })
  })
}

export async function onboardHours(ownerId: string, hours: Record<string, DayInput>) {
  const shop = await prisma.shop.findFirst({ where: { ownerId } })
  if (!shop) throw new AppError('not_found', 404)

  const records = Object.entries(hours).map(([day, h]) => ({
    shopId:    shop.id,
    dayOfWeek: DAY_MAP[day]!,
    openTime:  h.open,
    closeTime: h.close,
    isClosed:  h.closed,
  }))

  return prisma.$transaction(async (tx) => {
    await tx.businessHours.deleteMany({ where: { shopId: shop.id } })
    await tx.businessHours.createMany({ data: records })
    return tx.businessHours.findMany({ where: { shopId: shop.id }, orderBy: { dayOfWeek: 'asc' } })
  })
}

export async function onboardSubmit(ownerId: string) {
  const shop = await prisma.shop.findFirst({ where: { ownerId } })
  if (!shop) throw new AppError('not_found', 404)

  await prisma.shop.update({ where: { id: shop.id }, data: { status: 'PENDING' } })

  const admins = await prisma.user.findMany({ where: { role: 'ADMIN' } })
  await Promise.all(admins.map(admin =>
    createNotification(
      admin.id, 'SYSTEM_ALERT',
      'New Shop Application', 'طلب محل جديد',
      `New shop application waiting for review: ${shop.nameEn}`,
      `طلب محل جديد بانتظار المراجعة: ${shop.nameAr}`,
    ),
  ))
}
