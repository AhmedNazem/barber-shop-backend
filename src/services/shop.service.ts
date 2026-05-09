import { prisma } from "@/config/prisma";
import { AppError } from "@/lib/errors";
import { redisClient } from "@/lib/redis";
import { isShopOpen } from "@/lib/shop-hours";
import { computeLoad } from "@/lib/shop-load";

const RATING_TTL = 300;

export async function createShop(
  ownerId: string,
  data: {
    nameEn: string;
    nameAr: string;
    address: string;
    city: string;
    neighborhood: string;
    neighborhoodAr: string;
    phone: string;
    lat: number;
    lng: number;
  },
) {
  const existing = await prisma.shop.findFirst({ where: { ownerId } });
  if (existing) throw new AppError("conflict", 409);

  return prisma.shop.create({ data: { ownerId, ...data, status: "PENDING" } });
}

export async function updateShop(
  shopId: string,
  ownerId: string,
  data: Partial<{
    nameEn: string;
    nameAr: string;
    address: string;
    city: string;
    neighborhood: string;
    neighborhoodAr: string;
    phone: string;
    lat: number;
    lng: number;
  }>,
) {
  const shop = await prisma.shop.findUnique({ where: { id: shopId } });
  if (!shop) throw new AppError("not_found", 404);
  if (shop.ownerId !== ownerId) throw new AppError("forbidden", 403);

  return prisma.shop.update({ where: { id: shopId }, data });
}

export async function setShopImage(
  shopId: string,
  ownerId: string,
  field: "coverUrl" | "logoUrl",
  url: string,
) {
  const shop = await prisma.shop.findUnique({ where: { id: shopId } });
  if (!shop) throw new AppError("not_found", 404);
  if (shop.ownerId !== ownerId) throw new AppError("forbidden", 403);

  return prisma.shop.update({ where: { id: shopId }, data: { [field]: url } });
}

export async function getShopStatus(ownerId: string) {
  const shop = await prisma.shop.findFirst({ where: { ownerId } });
  if (!shop) throw new AppError("not_found", 404);

  return {
    status: shop.status,
    ...(shop.rejectionReason && { rejectionReason: shop.rejectionReason }),
  };
}

export async function getShop(shopId: string) {
  const shop = await prisma.shop.findUnique({
    where: { id: shopId },
    include: {
      hours: true,
      discount: true,
      services: {
        where: { isActive: true },
        include: { photos: { orderBy: { order: "asc" } } },
        orderBy: { nameEn: "asc" },
      },
      barbers: { where: { isActive: true }, orderBy: { nameEn: "asc" } },
    },
  });

  if (!shop || shop.status !== "APPROVED") throw new AppError("not_found", 404);

  const now = new Date();

  // Rating — Redis cache then DB fallback
  const cacheKey = `shop:rating:${shop.id}`;
  const cached = await redisClient.get(cacheKey);
  let avgRating: number | null = null;
  let reviewCount = 0;
  if (cached) {
    const parsed = JSON.parse(cached);
    avgRating = parsed.avgRating;
    reviewCount = parsed.reviewCount;
  } else {
    const agg = await prisma.review.aggregate({
      where: { shopId: shop.id, isVisible: true },
      _avg: { rating: true },
      _count: { rating: true },
    });
    avgRating = agg._avg.rating;
    reviewCount = agg._count.rating;
    await redisClient.setex(
      cacheKey,
      RATING_TTL,
      JSON.stringify({ avgRating, reviewCount }),
    );
  }

  const load = await computeLoad(shop.id);

  const discount =
    shop.discount &&
    shop.discount.expiresAt > now &&
    shop.discount.slotsClaimed < shop.discount.maxUsers
      ? { pct: shop.discount.pct, expiresAt: shop.discount.expiresAt }
      : null;

  return {
    id: shop.id,
    nameEn: shop.nameEn,
    nameAr: shop.nameAr,
    address: shop.address,
    city: shop.city,
    neighborhood: shop.neighborhood,
    neighborhoodAr: shop.neighborhoodAr,
    lat: shop.lat,
    lng: shop.lng,
    coverUrl: shop.coverUrl,
    logoUrl: shop.logoUrl,
    priceRange: shop.priceRange,
    plan: shop.plan,
    avgRating,
    reviewCount,
    isOpen: isShopOpen(shop.hours, now),
    load,
    discount,
    services: shop.services,
    barbers: shop.barbers,
  };
}
