import { prisma } from '@/config/prisma'

export type ReliabilityEvent = 'NO_SHOW' | 'LATE_CANCEL' | 'COMPLETION' | 'ON_TIME'

const SCORE_DELTA: Record<ReliabilityEvent, number> = {
  NO_SHOW:    -20,
  LATE_CANCEL: -10,
  COMPLETION:  +15,
  ON_TIME:     +5,
}

export async function applyReliabilityEvent(userId: string, event: ReliabilityEvent) {
  const delta = SCORE_DELTA[event]

  const record = await prisma.reliabilityRecord.upsert({
    where:  { userId },
    update: {
      score:      { increment: delta },
      ...(event === 'NO_SHOW' ? { noShowCount: { increment: 1 } } : {}),
      updatedAt:  new Date(),
    },
    create: {
      userId,
      score:      Math.min(100, Math.max(0, 100 + delta)),
      noShowCount: event === 'NO_SHOW' ? 1 : 0,
    },
  })

  // Clamp score to [0, 100]
  const clamped = Math.min(100, Math.max(0, record.score))
  if (clamped !== record.score) {
    await prisma.reliabilityRecord.update({ where: { userId }, data: { score: clamped } })
  }
}

export async function getReliability(userId: string) {
  const record = await prisma.reliabilityRecord.findUnique({ where: { userId } })
  if (!record) return { score: 100, noShowCount: 0, isBlocked: false }
  return {
    score:       record.score,
    noShowCount: record.noShowCount,
    isBlocked:   record.score < 50,
  }
}

export async function unblockUser(userId: string) {
  await prisma.reliabilityRecord.upsert({
    where:  { userId },
    update: { score: 60, noShowCount: 0 },
    create: { userId, score: 60, noShowCount: 0 },
  })
}
