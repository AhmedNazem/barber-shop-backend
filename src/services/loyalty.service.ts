import { prisma } from '@/config/prisma'
import { AppError } from '@/lib/errors'
import { LoyaltyTier } from '@prisma/client'

function calcTier(points: number): LoyaltyTier {
  if (points >= 500) return 'GOLD'
  if (points >= 100) return 'SILVER'
  return 'BRONZE'
}

export async function earnPoints(userId: string, totalPrice: number, bookingId?: string) {
  const pts = Math.floor(totalPrice / 1000)
  if (pts <= 0) return

  await prisma.$transaction(async (tx) => {
    const account = await tx.loyaltyAccount.upsert({
      where:  { userId },
      update: { points: { increment: pts } },
      create: { userId, points: pts, tier: 'BRONZE' },
    })

    const newTier = calcTier(account.points)
    await tx.loyaltyAccount.update({ where: { userId }, data: { tier: newTier } })

    if (newTier === 'GOLD') {
      await tx.user.updateMany({
        where: { id: userId, isVip: false },
        data:  { isVip: true, vipGrantedAt: new Date() },
      })
    }

    await tx.loyaltyTransaction.create({
      data: { userId, type: 'EARN', points: pts, bookingId },
    })
  })
}

export async function getLoyalty(userId: string) {
  const account = await prisma.loyaltyAccount.findUnique({ where: { userId } })
  const rewards = await prisma.loyaltyReward.findMany({ where: { isActive: true } })

  const points = account?.points ?? 0
  const tier   = account?.tier   ?? 'BRONZE'

  return {
    points,
    tier,
    availableRewards: rewards.filter(r => r.pointsCost <= points),
    allRewards:       rewards,
  }
}

export async function redeemReward(userId: string, rewardId: string) {
  await prisma.$transaction(async (tx) => {
    const reward = await tx.loyaltyReward.findUnique({ where: { id: rewardId } })
    if (!reward || !reward.isActive) throw new AppError('not_found', 404)

    const account = await tx.loyaltyAccount.findUnique({ where: { userId } })
    const points  = account?.points ?? 0
    if (points < reward.pointsCost) throw new AppError('insufficient_points', 422)

    const newPoints = points - reward.pointsCost
    const newTier   = calcTier(newPoints)

    await tx.loyaltyAccount.update({
      where: { userId },
      data:  { points: { decrement: reward.pointsCost }, tier: newTier },
    })

    if (newTier !== 'GOLD') {
      await tx.user.updateMany({
        where: { id: userId, isVip: true },
        data:  { isVip: false },
      })
    }

    await tx.loyaltyTransaction.create({
      data: { userId, type: 'REDEEM', points: -reward.pointsCost, rewardId },
    })
  })
}
