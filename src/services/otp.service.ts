import bcrypt from 'bcrypt'
import { randomInt } from 'crypto'
import { prisma } from '@/config/prisma'
import { AppError } from '@/lib/errors'
import { sendSms, normalisePhone } from '@/lib/sms'

const OTP_TTL_MS = 5 * 60 * 1000
const OTP_MAX_ATTEMPTS = 5
const BCRYPT_ROUNDS = 10

function generateOtpCode(): string {
  // crypto.randomInt is cryptographically secure unlike Math.random()
  return randomInt(100000, 1000000).toString()
}

/**
 * Generate a fresh OTP for `phone`, store it hashed, and send via SMS.
 * Any previous unused codes for this phone are deleted atomically.
 */
export async function requestOtp(phone: string): Promise<void> {
  const e164 = normalisePhone(phone)
  const plainCode = generateOtpCode()
  const hashedCode = await bcrypt.hash(plainCode, BCRYPT_ROUNDS)
  const expiresAt = new Date(Date.now() + OTP_TTL_MS)

  await prisma.$transaction([
    prisma.otpCode.deleteMany({ where: { phone: e164, usedAt: null } }),
    prisma.otpCode.create({ data: { phone: e164, code: hashedCode, expiresAt } }),
  ])

  await sendSms(e164, `رمز التحقق الخاص بك هو: ${plainCode}\nصالح لمدة 5 دقائق.`)
}

/**
 * Verify `plainCode` against the latest unused OTP for `phone`.
 * Throws AppError on any failure — callers must not catch and retry silently.
 */
export async function verifyOtp(phone: string, plainCode: string): Promise<void> {
  const e164 = normalisePhone(phone)
  const record = await prisma.otpCode.findFirst({
    where: { phone: e164, usedAt: null },
    orderBy: { createdAt: 'desc' },
  })

  // No active code found — don't distinguish from wrong code (anti-enumeration)
  if (!record) {
    throw new AppError('invalid_otp', 401)
  }

  // Already locked from too many attempts
  if (record.locked) {
    const retryAfter = Math.max(0, Math.ceil((record.expiresAt.getTime() - Date.now()) / 1000))
    throw new AppError('otp_locked', 429, `retryAfter:${retryAfter}`)
  }

  // Code window has passed
  if (record.expiresAt < new Date()) {
    throw new AppError('otp_expired', 410)
  }

  // Pre-check: if this attempt would hit the limit, lock before comparing
  const nextAttempts = record.attempts + 1
  const willLock = nextAttempts >= OTP_MAX_ATTEMPTS

  const isMatch = await bcrypt.compare(plainCode, record.code)

  if (!isMatch) {
    // Increment attempts; lock if threshold reached
    await prisma.otpCode.update({
      where: { id: record.id },
      data: { attempts: nextAttempts, locked: willLock },
    })

    if (willLock) {
      const retryAfter = Math.max(0, Math.ceil((record.expiresAt.getTime() - Date.now()) / 1000))
      throw new AppError('otp_locked', 429, `retryAfter:${retryAfter}`)
    }

    throw new AppError('invalid_otp', 401)
  }

  // Correct code — mark as used
  await prisma.otpCode.update({
    where: { id: record.id },
    data: { usedAt: new Date() },
  })
}
