import bcrypt from 'bcrypt'
import { prisma } from '@/config/prisma'

export async function seedOtp(
  e164: string,
  opts: { expired?: boolean; locked?: boolean; attempts?: number } = {},
) {
  const plainCode = '123456'
  const hashed = await bcrypt.hash(plainCode, 10)
  await prisma.otpCode.create({
    data: {
      phone: e164,
      code: hashed,
      expiresAt: opts.expired
        ? new Date(Date.now() - 1000)
        : new Date(Date.now() + 5 * 60 * 1000),
      locked: opts.locked ?? false,
      attempts: opts.attempts ?? 0,
    },
  })
  return plainCode
}

export async function cleanupPhone(e164: string) {
  await prisma.refreshToken.deleteMany({ where: { user: { phone: e164 } } })
  await prisma.user.deleteMany({ where: { phone: e164 } })
  await prisma.otpCode.deleteMany({ where: { phone: e164 } })
}
