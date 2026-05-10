/**
 * Run once to add test barbers + services + schedules to an existing shop.
 * Usage: npx ts-node --project tsconfig.json seed-test-shop.ts
 */
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();
const SHOP_ID = 'cmojy02aa000084w9i2lkeii1';

// Mon–Sat (1–6), 09:00–18:00
const DAYS = [1, 2, 3, 4, 5, 6];

async function main() {
  // ── Services ──────────────────────────────────────────────────────────────
  const services = await Promise.all([
    prisma.service.upsert({
      where: { id: 'test-svc-haircut' },
      update: {},
      create: {
        id: 'test-svc-haircut',
        shopId: SHOP_ID,
        nameEn: 'Haircut',
        nameAr: 'قصة شعر',
        price: 5000,
        durationMin: 30,
        category: 'haircut',
        isActive: true,
      },
    }),
    prisma.service.upsert({
      where: { id: 'test-svc-beard' },
      update: {},
      create: {
        id: 'test-svc-beard',
        shopId: SHOP_ID,
        nameEn: 'Beard Trim',
        nameAr: 'تشذيب اللحية',
        price: 3000,
        durationMin: 20,
        category: 'beard',
        isActive: true,
      },
    }),
    prisma.service.upsert({
      where: { id: 'test-svc-combo' },
      update: {},
      create: {
        id: 'test-svc-combo',
        shopId: SHOP_ID,
        nameEn: 'Hair + Beard Combo',
        nameAr: 'شعر + لحية',
        price: 7500,
        durationMin: 45,
        category: 'combo',
        isActive: true,
      },
    }),
  ]);
  console.log(`✓ ${services.length} services upserted`);

  // ── Barber 1 ──────────────────────────────────────────────────────────────
  const barber1 = await prisma.barber.upsert({
    where: { id: 'test-barber-ali' },
    update: {},
    create: {
      id: 'test-barber-ali',
      shopId: SHOP_ID,
      nameEn: 'Ali Hassan',
      nameAr: 'علي حسن',
      specialties: ['fade', 'classic'],
      experienceYears: 5,
      isActive: true,
    },
  });

  await prisma.barberSchedule.deleteMany({ where: { barberId: barber1.id } });
  await prisma.barberSchedule.createMany({
    data: DAYS.map((day) => ({
      barberId: barber1.id,
      dayOfWeek: day,
      startTime: '09:00',
      endTime: '18:00',
      isAvailable: true,
    })),
  });
  console.log(`✓ Barber 1: ${barber1.nameEn} with ${DAYS.length} schedule days`);

  // ── Barber 2 ──────────────────────────────────────────────────────────────
  const barber2 = await prisma.barber.upsert({
    where: { id: 'test-barber-omar' },
    update: {},
    create: {
      id: 'test-barber-omar',
      shopId: SHOP_ID,
      nameEn: 'Omar Khalid',
      nameAr: 'عمر خالد',
      specialties: ['beard', 'razor'],
      experienceYears: 3,
      isActive: true,
    },
  });

  await prisma.barberSchedule.deleteMany({ where: { barberId: barber2.id } });
  await prisma.barberSchedule.createMany({
    data: DAYS.map((day) => ({
      barberId: barber2.id,
      dayOfWeek: day,
      startTime: '10:00',
      endTime: '19:00',
      isAvailable: true,
    })),
  });
  console.log(`✓ Barber 2: ${barber2.nameEn} with ${DAYS.length} schedule days`);

  // ── Business hours (Sun–Sat, all open 09:00–20:00) ───────────────────────
  await prisma.businessHours.deleteMany({ where: { shopId: SHOP_ID } });
  await prisma.businessHours.createMany({
    data: [0, 1, 2, 3, 4, 5, 6].map((day) => ({
      shopId: SHOP_ID,
      dayOfWeek: day,
      openTime: '09:00',
      closeTime: '20:00',
      isClosed: false,
    })),
  });
  console.log('✓ BusinessHours: all 7 days 09:00–20:00');

  // ── Upgrade plan + confirm APPROVED + isActive ────────────────────────────
  await prisma.shop.update({
    where: { id: SHOP_ID },
    data: { status: 'APPROVED', isActive: true, plan: 'STARTER', bookingMode: 'BOTH' },
  });
  console.log('✓ Shop: APPROVED + isActive + plan=STARTER');

  console.log('\nDone. Test the booking flow at /shops/' + SHOP_ID);
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(() => prisma.$disconnect());
