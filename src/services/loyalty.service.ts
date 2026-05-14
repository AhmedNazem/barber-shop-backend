import { prisma } from '@/config/prisma'
import { AppError } from '@/lib/errors'
import { LoyaltyTier } from '@prisma/client'

const INVITE_BONUS = 50

export function calcTier(points: number): LoyaltyTier {
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

async function earnBonusPoints(userId: string, pts: number) {
  await prisma.$transaction(async (tx) => {
    const account = await tx.loyaltyAccount.upsert({
      where:  { userId },
      update: { points: { increment: pts } },
      create: { userId, points: pts, tier: 'BRONZE' },
    })
    const newTier = calcTier(account.points)
    await tx.loyaltyAccount.update({ where: { userId }, data: { tier: newTier } })
    if (newTier === 'GOLD') {
      await tx.user.updateMany({ where: { id: userId, isVip: false }, data: { isVip: true, vipGrantedAt: new Date() } })
    }
    await tx.loyaltyTransaction.create({ data: { userId, type: 'BONUS', points: pts } })
  })
}

export async function awardInviteBonus(customerId: string) {
  const user = await prisma.user.findUnique({
    where:  { id: customerId },
    select: { referredById: true },
  })
  if (!user?.referredById) return

  const doneCount = await prisma.queueEntry.count({
    where: { booking: { customerId }, status: 'DONE' },
  })
  if (doneCount !== 1) return

  await earnBonusPoints(user.referredById, INVITE_BONUS)
}

export async function expireOldPoints(): Promise<number> {
  const cutoff = new Date(Date.now() - 365 * 24 * 60 * 60 * 1000)
  const old = await prisma.loyaltyTransaction.findMany({
    where:  { type: 'EARN', expired: false, createdAt: { lt: cutoff } },
    select: { id: true, userId: true, points: true },
  })

  const byUser = new Map<string, { ids: string[]; total: number }>()
  for (const tx of old) {
    const entry = byUser.get(tx.userId) ?? { ids: [], total: 0 }
    entry.ids.push(tx.id)
    entry.total += tx.points
    byUser.set(tx.userId, entry)
  }

  for (const [userId, { ids, total }] of byUser) {
    await prisma.$transaction(async (tx) => {
      await tx.loyaltyTransaction.updateMany({ where: { id: { in: ids } }, data: { expired: true } })
      const account = await tx.loyaltyAccount.findUnique({ where: { userId } })
      const deduct = Math.min(total, account?.points ?? 0)
      if (deduct <= 0) return
      const newPoints = (account?.points ?? 0) - deduct
      const newTier = calcTier(newPoints)
      await tx.loyaltyAccount.update({ where: { userId }, data: { points: { decrement: deduct }, tier: newTier } })
      if (newTier !== 'GOLD') {
        await tx.user.updateMany({ where: { id: userId, isVip: true }, data: { isVip: false } })
      }
      await tx.loyaltyTransaction.create({ data: { userId, type: 'EXPIRE', points: -deduct } })
    })
  }

  return byUser.size
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
