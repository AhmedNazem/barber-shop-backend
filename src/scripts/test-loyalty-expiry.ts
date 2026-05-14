import { prisma } from '@/config/prisma'
import { expireOldPoints } from '@/services/loyalty.service'

async function main() {
  const userId = process.argv[2]
  if (!userId) { console.error('Usage: tsx src/scripts/test-loyalty-expiry.ts <userId>'); process.exit(1) }

  // Backdate one EARN transaction to 13 months ago to simulate expiry
  const tx = await prisma.loyaltyTransaction.findFirst({
    where: { userId, type: 'EARN', expired: false },
  })
  if (!tx) { console.log('No EARN transactions found for this user'); process.exit(0) }

  const thirteenMonthsAgo = new Date(Date.now() - 13 * 30 * 24 * 60 * 60 * 1000)
  await prisma.loyaltyTransaction.update({
    where: { id: tx.id },
    data: { createdAt: thirteenMonthsAgo },
  })
  console.log(`Backdated transaction ${tx.id} (${tx.points} pts) to ${thirteenMonthsAgo.toISOString()}`)

  const before = await prisma.loyaltyAccount.findUnique({ where: { userId } })
  console.log(`Points before: ${before?.points ?? 0}`)

  const count = await expireOldPoints()
  console.log(`expireOldPoints() processed ${count} users`)

  const after = await prisma.loyaltyAccount.findUnique({ where: { userId } })
  console.log(`Points after: ${after?.points ?? 0}`)

  const expireTx = await prisma.loyaltyTransaction.findFirst({
    where: { userId, type: 'EXPIRE' },
    orderBy: { createdAt: 'desc' },
  })
  console.log('EXPIRE transaction:', expireTx)

  await prisma.$disconnect()
}

main().catch((e) => { console.error(e); process.exit(1) })
