import { PrismaClient, UserRole, ShopStatus, ShopPlan, BookingMode, PriceRange, PaymentMethod, BookingStatus, PaymentStatus } from '@prisma/client'

const prisma = new PrismaClient()

const DAYS = [0, 1, 2, 3, 4, 5, 6]

const USERS = [
  { id: 'seed-user-admin',      phone: '+9647800000000', name: 'Admin',       role: UserRole.ADMIN },
  { id: 'seed-user-owner-1',    phone: '+9647800000001', name: 'Owner Mansour', role: UserRole.SHOP_OWNER },
  { id: 'seed-user-owner-2',    phone: '+9647800000002', name: 'Owner Karrada', role: UserRole.SHOP_OWNER },
  { id: 'seed-user-owner-3',    phone: '+9647800000003', name: 'Owner Kadhimiya', role: UserRole.SHOP_OWNER },
  { id: 'seed-user-customer-1', phone: '+9647800000010', name: 'Ali Kareem',   role: UserRole.CUSTOMER },
  { id: 'seed-user-customer-2', phone: '+9647800000011', name: 'Sara Ahmed',   role: UserRole.CUSTOMER },
]

const SHOPS = [
  { id: 'seed-shop-1', ownerId: 'seed-user-owner-1', nameEn: 'Capital Cuts',     nameAr: 'كابيتال كاتس',   address: '12 Mansour St',    neighborhood: 'Mansour',   neighborhoodAr: 'المنصور',  lat: 33.3152, lng: 44.3661 },
  { id: 'seed-shop-2', ownerId: 'seed-user-owner-2', nameEn: 'Baghdad Blades',   nameAr: 'بغداد بليدز',    address: '45 Karrada St',    neighborhood: 'Karrada',   neighborhoodAr: 'الكرادة',  lat: 33.3061, lng: 44.4028 },
  { id: 'seed-shop-3', ownerId: 'seed-user-owner-3', nameEn: 'Al-Rashid Barbers',nameAr: 'حلاقة الرشيد',   address: '8 Kadhimiya Rd',   neighborhood: 'Kadhimiya', neighborhoodAr: 'الكاظمية', lat: 33.3788, lng: 44.3183 },
]

const SERVICES = [
  { nameEn: 'Haircut',        nameAr: 'قصة شعر',       price: 7500,  durationMin: 30, category: 'haircut'   },
  { nameEn: 'Beard Trim',     nameAr: 'تشذيب اللحية',  price: 5000,  durationMin: 20, category: 'beard'     },
  { nameEn: 'Hot Shave',      nameAr: 'حلاقة ساخنة',   price: 10000, durationMin: 45, category: 'shave'     },
  { nameEn: 'Kids Cut',       nameAr: 'قصة أطفال',     price: 5000,  durationMin: 20, category: 'kids'      },
  { nameEn: 'Hair Treatment', nameAr: 'علاج الشعر',    price: 15000, durationMin: 60, category: 'treatment' },
]

const BARBERS = [
  [
    { nameEn: 'Ahmed Hassan',  nameAr: 'أحمد حسن',    specialties: ['fade', 'beard'],       experienceYears: 5 },
    { nameEn: 'Mohammed Ali',  nameAr: 'محمد علي',    specialties: ['classic', 'shave'],    experienceYears: 8 },
  ],
  [
    { nameEn: 'Omar Khalil',   nameAr: 'عمر خليل',    specialties: ['modern', 'kids'],      experienceYears: 3 },
    { nameEn: 'Yusuf Ibrahim', nameAr: 'يوسف إبراهيم', specialties: ['fade', 'treatment'],  experienceYears: 6 },
  ],
  [
    { nameEn: 'Kareem Nasser', nameAr: 'كريم ناصر',   specialties: ['classic', 'beard'],    experienceYears: 10 },
    { nameEn: 'Hassan Qasim',  nameAr: 'حسن قاسم',    specialties: ['modern', 'fade'],      experienceYears: 4  },
  ],
]

async function main() {
  console.log('Seeding database...')

  for (const u of USERS) {
    await prisma.user.upsert({ where: { id: u.id }, update: {}, create: u })
  }
  console.log(`  ${USERS.length} users`)

  for (let i = 0; i < SHOPS.length; i++) {
    const shop = SHOPS[i]
    await prisma.shop.upsert({
      where: { id: shop.id },
      update: {},
      create: {
        ...shop, city: 'Baghdad', phone: `+964780100000${i + 1}`,
        status: ShopStatus.APPROVED, isActive: true, plan: ShopPlan.FREE,
        bookingMode: BookingMode.QUEUE_ONLY, priceRange: PriceRange.MID,
      },
    })

    for (let j = 0; j < SERVICES.length; j++) {
      await prisma.service.upsert({
        where: { id: `seed-svc-${i + 1}-${j + 1}` },
        update: {},
        create: { id: `seed-svc-${i + 1}-${j + 1}`, shopId: shop.id, ...SERVICES[j] },
      })
    }

    for (let j = 0; j < BARBERS[i].length; j++) {
      const barberId = `seed-barber-${i + 1}-${j + 1}`
      await prisma.barber.upsert({
        where: { id: barberId },
        update: {},
        create: { id: barberId, shopId: shop.id, ...BARBERS[i][j] },
      })
      for (const day of DAYS) {
        await prisma.barberSchedule.upsert({
          where: { id: `seed-sched-${i + 1}-${j + 1}-${day}` },
          update: {},
          create: { id: `seed-sched-${i + 1}-${j + 1}-${day}`, barberId, dayOfWeek: day, startTime: '09:00', endTime: '21:00', isAvailable: day !== 5 },
        })
      }
    }

    for (const day of DAYS) {
      await prisma.businessHours.upsert({
        where: { id: `seed-hours-${i + 1}-${day}` },
        update: {},
        create: { id: `seed-hours-${i + 1}-${day}`, shopId: shop.id, dayOfWeek: day, openTime: '09:00', closeTime: '21:00', isClosed: day === 5 },
      })
    }
  }
  console.log('  3 shops with services, barbers, and hours')

  const tomorrow = new Date()
  tomorrow.setDate(tomorrow.getDate() + 1)
  tomorrow.setHours(10, 0, 0, 0)

  await prisma.booking.upsert({
    where: { id: 'seed-booking-1' },
    update: {},
    create: {
      id: 'seed-booking-1', customerId: 'seed-user-customer-1', shopId: 'seed-shop-1',
      barberId: 'seed-barber-1-1', slot: tomorrow, status: BookingStatus.CONFIRMED,
      totalPrice: 7500, depositPaid: 0, paymentMethod: PaymentMethod.CASH, paymentStatus: PaymentStatus.PENDING,
      services: { create: [{ serviceId: 'seed-svc-1-1', nameEn: 'Haircut', nameAr: 'قصة شعر', price: 7500, durationMin: 30 }] },
    },
  })

  const slot2 = new Date(tomorrow)
  slot2.setHours(11, 0, 0, 0)
  await prisma.booking.upsert({
    where: { id: 'seed-booking-2' },
    update: {},
    create: {
      id: 'seed-booking-2', customerId: 'seed-user-customer-2', shopId: 'seed-shop-2',
      slot: slot2, status: BookingStatus.UPCOMING,
      totalPrice: 12500, depositPaid: 0, paymentMethod: PaymentMethod.CASH, paymentStatus: PaymentStatus.PENDING,
      services: { create: [
        { serviceId: 'seed-svc-2-1', nameEn: 'Haircut',    nameAr: 'قصة شعر',      price: 7500, durationMin: 30 },
        { serviceId: 'seed-svc-2-2', nameEn: 'Beard Trim', nameAr: 'تشذيب اللحية', price: 5000, durationMin: 20 },
      ]},
    },
  })
  console.log('  2 sample bookings')

  console.log('\nDone! Test accounts:')
  console.log('  Admin:      +9647800000000')
  console.log('  Customer 1: +9647800000010')
  console.log('  Customer 2: +9647800000011')
}

main().catch(console.error).finally(() => prisma.$disconnect())
