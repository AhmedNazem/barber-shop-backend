import { prisma } from '@/config/prisma'
import { searchNearbyBarbers } from '@/lib/google-maps'

const CITIES = [
  { name: 'Ramadi',   city: 'Ramadi',   lat: 33.4258, lng: 43.2993 },
  { name: 'Fallujah', city: 'Fallujah', lat: 33.3432, lng: 43.7769 },
  { name: 'Hit',      city: 'Hit',      lat: 33.6365, lng: 42.8229 },
  { name: 'Haditha',  city: 'Haditha',  lat: 34.1115, lng: 42.3767 },
]

export type SyncStats = { city: string; upserted: number }[]

export async function syncAnbarShops(): Promise<SyncStats> {
  const stats: SyncStats = []

  for (const { name, city, lat, lng } of CITIES) {
    const places = await searchNearbyBarbers(lat, lng)
    let upserted = 0

    for (const p of places) {
      const neighborhood = p.neighborhood || city

      await prisma.shop.upsert({
        where:  { placeId: p.placeId },
        update: { phone: p.phone, address: p.address, lat: p.lat, lng: p.lng },
        create: {
          placeId:        p.placeId,
          ownerId:        null,
          nameEn:         p.nameEn,
          nameAr:         p.nameAr,
          address:        p.address,
          city,
          neighborhood,
          neighborhoodAr: neighborhood,
          phone:          p.phone,
          lat:            p.lat,
          lng:            p.lng,
          status:         'PENDING',
          isActive:       false,
          plan:           'FREE',
          bookingMode:    'QUEUE_ONLY',
        },
      })
      upserted++
    }

    stats.push({ city: name, upserted })
    console.log(`[shop-sync] ${name}: ${upserted} shops upserted`)
  }

  return stats
}
