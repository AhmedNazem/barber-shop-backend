import { prisma } from '../src/config/prisma'
import { syncAnbarShops } from '../src/services/shop-sync.service'

async function main() {
  console.log('[seed] Starting Anbar barbershop seed...')
  const stats = await syncAnbarShops()
  const total = stats.reduce((sum, s) => sum + s.upserted, 0)
  console.log(`[seed] Done. Total upserted: ${total}`)
  for (const { city, upserted } of stats) {
    console.log(`  ${city}: ${upserted}`)
  }
}

main()
  .catch(err => { console.error('[seed] Error:', err); process.exit(1) })
  .finally(() => prisma.$disconnect())
