import { randomBytes } from 'crypto'
import { prisma } from '@/config/prisma'
import { AppError } from '@/lib/errors'
import { verifyOtp } from '@/services/otp.service'
import { normalisePhone } from '@/lib/sms'
import { issueTokens } from '@/services/auth.service'
import { UserRole } from '@prisma/client'

const INVITE_TTL_MS = 48 * 60 * 60 * 1000

export async function generateInvite(ownerId: string, nameEn: string, nameAr: string) {
  const shop = await prisma.shop.findFirst({ where: { ownerId } })
  if (!shop) throw new AppError('forbidden', 403)

  const code = randomBytes(16).toString('hex')
  const expiresAt = new Date(Date.now() + INVITE_TTL_MS)

  await prisma.$transaction(async (tx) => {
    const barber = await tx.barber.create({
      data: { shopId: shop.id, nameEn, nameAr },
    })
    await tx.inviteCode.create({
      data: { shopId: shop.id, staffId: barber.id, code, expiresAt },
    })
  })

  return { code, expiresAt }
}

export async function getInviteInfo(code: string) {
  const invite = await prisma.inviteCode.findUnique({ where: { code } })
  if (!invite) throw new AppError('not_found', 404)
  if (invite.usedAt) throw new AppError('conflict', 409)
  if (invite.expiresAt < new Date()) throw new AppError('otp_expired', 410)

  const [shop, barber] = await Promise.all([
    prisma.shop.findUnique({ where: { id: invite.shopId } }),
    prisma.barber.findUnique({ where: { id: invite.staffId } }),
  ])

  return {
    shopNameEn: shop!.nameEn,
    shopNameAr: shop!.nameAr,
    barberNameEn: barber!.nameEn,
    barberNameAr: barber!.nameAr,
  }
}

export async function acceptInvite(code: string, phone: string, otp: string) {
  const e164 = normalisePhone(phone)

  const invite = await prisma.inviteCode.findUnique({ where: { code } })
  if (!invite) throw new AppError('not_found', 404)
  if (invite.usedAt) throw new AppError('conflict', 409)
  if (invite.expiresAt < new Date()) throw new AppError('otp_expired', 410)

  await verifyOtp(e164, otp)

  const user = await prisma.$transaction(async (tx) => {
    let u = await tx.user.findUnique({ where: { phone: e164 } })
    const barber = await tx.barber.findUnique({ where: { id: invite.staffId } })

    if (!u) {
      u = await tx.user.create({
        data: { phone: e164, name: barber!.nameEn, role: UserRole.BARBER, shopId: invite.shopId },
      })
    } else {
      u = await tx.user.update({
        where: { id: u.id },
        data: { role: UserRole.BARBER, shopId: invite.shopId },
      })
    }

    await tx.barber.update({ where: { id: invite.staffId }, data: { userId: u.id } })
    await tx.inviteCode.update({ where: { id: invite.id }, data: { usedAt: new Date() } })
    return u
  })

  const tokens = await issueTokens(user)
  return { ...tokens, role: user.role }
}
