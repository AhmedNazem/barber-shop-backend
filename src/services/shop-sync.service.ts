import { prisma } from "@/config/prisma";
import { searchNearbyBarbers } from "@/lib/google-maps";
import { createNotification } from "@/services/notification.service";

const CITIES = [
  { name: "Ramadi", city: "Ramadi", lat: 33.4258, lng: 43.2993 },
  { name: "Fallujah", city: "Fallujah", lat: 33.3432, lng: 43.7769 },
  { name: "Hit", city: "Hit", lat: 33.6365, lng: 42.8229 },
  { name: "Haditha", city: "Haditha", lat: 34.1115, lng: 42.3767 },
];

export type SyncStats = { city: string; upserted: number; newShops: number }[];

export async function syncAnbarShops(): Promise<SyncStats> {
  // Fetch all existing placeIds once to detect new vs updated shops
  const existing = await prisma.shop.findMany({
    where: { placeId: { not: null } },
    select: { placeId: true },
  });
  const existingPlaceIds = new Set(existing.map((s) => s.placeId!));

  const stats: SyncStats = [];
  let totalNew = 0;

  for (const { name, city, lat, lng } of CITIES) {
    const places = await searchNearbyBarbers(lat, lng);
    let upserted = 0;
    let newShops = 0;

    for (const p of places) {
      const isNew = !existingPlaceIds.has(p.placeId);

      const neighborhood = p.neighborhood || city;

      await prisma.shop.upsert({
        where: { placeId: p.placeId },
        update: { phone: p.phone, address: p.address, lat: p.lat, lng: p.lng },
        create: {
          placeId: p.placeId,
          ownerId: null,
          nameEn: p.nameEn,
          nameAr: p.nameAr,
          address: p.address,
          city,
          neighborhood,
          neighborhoodAr: neighborhood,
          phone: p.phone,
          lat: p.lat,
          lng: p.lng,
          status: "PENDING",
          isActive: false,
          plan: "FREE",
          bookingMode: "QUEUE_ONLY",
        },
      });

      if (isNew) {
        newShops++;
        existingPlaceIds.add(p.placeId);
      }
      upserted++;
    }

    stats.push({ city: name, upserted, newShops });
    console.log(`[shop-sync] ${name}: ${upserted} upserted (${newShops} new)`);
    totalNew += newShops;
  }

  if (totalNew > 0) {
    const admins = await prisma.user.findMany({
      where: { role: "ADMIN" },
      select: { id: true },
    });
    await Promise.all(
      admins.map((a) =>
        createNotification(
          a.id,
          "SYSTEM_ALERT",
          "New Barbershops Found",
          "تم اكتشاف محلات حلاقة جديدة",
          `${totalNew} new barbershop(s) discovered in Anbar — pending your review.`,
          `تم اكتشاف ${totalNew} محل حلاقة جديد في الأنبار — بانتظار مراجعتك.`,
        ),
      ),
    );
    console.log(
      `[shop-sync] notified ${admins.length} admin(s) of ${totalNew} new shops`,
    );
  }

  return stats;
}
