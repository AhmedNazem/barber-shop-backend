import { prisma } from '@/config/prisma'
import { signAccess, signRefresh, verifyRefresh } from '@/lib/jwt'
import { AppError } from '@/lib/errors'
import { UserRole } from '@prisma/client'

const REFRESH_TTL_MS = 7 * 24 * 60 * 60 * 1000

export async function createOrFindUser(
  e164: string,
  opts: { name?: string; shopName?: string; isRegister?: boolean },
) {
  let user = await prisma.user.findUnique({ where: { phone: e164 } })

  if (opts.isRegister) {
    if (!user) {
      if (!opts.name) throw new AppError('name_required', 400)
      user = await prisma.user.create({
        data: {
          phone: e164,
          name: opts.name,
          role: opts.shopName ? UserRole.SHOP_OWNER : UserRole.CUSTOMER,
        },
      })
    }
  } else {
    if (!user) throw new AppError('user_not_found', 404)
  }

  return user
}

export async function issueTokens(user: { id: string; role: string; shopId: string | null }) {
  const payload = { id: user.id, role: user.role, shopId: user.shopId ?? undefined }
  const accessToken = signAccess(payload)
  const refreshToken = signRefresh(payload)

  await prisma.refreshToken.create({
    data: { userId: user.id, token: refreshToken, expiresAt: new Date(Date.now() + REFRESH_TTL_MS) },
  })

  return { accessToken, refreshToken }
}

export async function rotateAccessToken(token: string) {
  let payload: ReturnType<typeof verifyRefresh>
  try {
    payload = verifyRefresh(token)
  } catch {
    throw new AppError('unauthorized', 401)
  }

  const stored = await prisma.refreshToken.findUnique({ where: { token } })
  if (!stored || stored.expiresAt < new Date()) throw new AppError('unauthorized', 401)

  return signAccess({ id: payload.id, role: payload.role, shopId: payload.shopId })
}

export async function revokeToken(token: string) {
  await prisma.refreshToken.deleteMany({ where: { token } })
}

export async function getSession(userId: string) {
  const user = await prisma.user.findUnique({ where: { id: userId } })
  if (!user) throw new AppError('unauthorized', 401)

  let shop = null
  if (user.role === UserRole.SHOP_OWNER) {
    shop = await prisma.shop.findFirst({ where: { ownerId: user.id } })
  } else if (user.shopId) {
    shop = await prisma.shop.findUnique({ where: { id: user.shopId } })
  }

  return {
    id: user.id,
    phone: user.phone,
    name: user.name,
    role: user.role,
    isVip: user.isVip,
    ...(shop && { shopId: shop.id, shopStatus: shop.status, plan: shop.plan }),
  }
}
