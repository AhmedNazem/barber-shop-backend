import { describe, it, expect, afterEach, vi } from 'vitest'
import bcrypt from 'bcrypt'
import { prisma } from '@/config/prisma'
import { requestOtp, verifyOtp } from '@/services/otp.service'
import { AppError } from '@/lib/errors'

// Mock sendSms — we don't want real WhatsApp messages in tests.
// normalisePhone is kept real so DB lookups still use E.164.
vi.mock('@/lib/sms', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/sms')>()
  return { ...actual, sendSms: vi.fn().mockResolvedValue(undefined) }
})

const TEST_PHONE = '07900000099'   // fake number, never a real user
const E164 = '+9647900000099'

// Insert an OTP with a known plain code directly — bypasses random generation
async function seedOtp(opts: { expired?: boolean; locked?: boolean; attempts?: number } = {}) {
  const plainCode = '123456'
  const hashed = await bcrypt.hash(plainCode, 10)
  await prisma.otpCode.create({
    data: {
      phone: E164,
      code: hashed,
      expiresAt: opts.expired
        ? new Date(Date.now() - 1000)           // 1 second in the past
        : new Date(Date.now() + 5 * 60 * 1000), // 5 minutes from now
      locked: opts.locked ?? false,
      attempts: opts.attempts ?? 0,
    },
  })
  return plainCode
}

afterEach(async () => {
  await prisma.otpCode.deleteMany({ where: { phone: E164 } })
})

// ─── requestOtp ───────────────────────────────────────────────────────────────

describe('requestOtp', () => {
  it('creates an OtpCode row in the DB with a hashed code', async () => {
    await requestOtp(TEST_PHONE)

    const record = await prisma.otpCode.findFirst({ where: { phone: E164 } })
    expect(record).not.toBeNull()
    expect(record!.code).not.toHaveLength(6)   // stored value is the bcrypt hash, not plain
    expect(record!.usedAt).toBeNull()
    expect(record!.locked).toBe(false)
    expect(record!.attempts).toBe(0)
  })

  it('stores the phone in E.164 format regardless of input format', async () => {
    await requestOtp('07900000099')

    const record = await prisma.otpCode.findFirst({ where: { phone: E164 } })
    expect(record).not.toBeNull()
  })

  it('deletes the old unused code when a new one is requested', async () => {
    await requestOtp(TEST_PHONE)
    await requestOtp(TEST_PHONE)

    const records = await prisma.otpCode.findMany({ where: { phone: E164 } })
    expect(records).toHaveLength(1)  // old one deleted, only the new one remains
  })

  it('sets expiresAt 5 minutes from now', async () => {
    const before = Date.now()
    await requestOtp(TEST_PHONE)
    const after = Date.now()

    const record = await prisma.otpCode.findFirst({ where: { phone: E164 } })
    const ttl = record!.expiresAt.getTime()

    expect(ttl).toBeGreaterThanOrEqual(before + 5 * 60 * 1000 - 100)
    expect(ttl).toBeLessThanOrEqual(after + 5 * 60 * 1000 + 100)
  })
})

// ─── verifyOtp ────────────────────────────────────────────────────────────────

describe('verifyOtp', () => {
  it('succeeds and marks code as used when the code is correct', async () => {
    const code = await seedOtp()
    await verifyOtp(TEST_PHONE, code)

    const record = await prisma.otpCode.findFirst({ where: { phone: E164 } })
    expect(record!.usedAt).not.toBeNull()
  })

  it('throws invalid_otp (401) when no active code exists for the phone', async () => {
    await expect(verifyOtp(TEST_PHONE, '000000')).rejects.toMatchObject({
      code: 'invalid_otp',
      status: 401,
    })
  })

  it('throws invalid_otp (401) when the code is wrong', async () => {
    await seedOtp()
    await expect(verifyOtp(TEST_PHONE, '000000')).rejects.toMatchObject({
      code: 'invalid_otp',
      status: 401,
    })
  })

  it('throws otp_expired (410) when the code TTL has passed', async () => {
    await seedOtp({ expired: true })
    await expect(verifyOtp(TEST_PHONE, '123456')).rejects.toMatchObject({
      code: 'otp_expired',
      status: 410,
    })
  })

  it('throws otp_locked (429) when the record is already locked', async () => {
    await seedOtp({ locked: true })
    await expect(verifyOtp(TEST_PHONE, '123456')).rejects.toMatchObject({
      code: 'otp_locked',
      status: 429,
    })
  })

  it('locks the code and throws otp_locked after 5 wrong attempts', async () => {
    await seedOtp({ attempts: 4 }) // one more wrong attempt will hit the limit

    await expect(verifyOtp(TEST_PHONE, '000000')).rejects.toMatchObject({
      code: 'otp_locked',
      status: 429,
    })

    const record = await prisma.otpCode.findFirst({ where: { phone: E164 } })
    expect(record!.locked).toBe(true)
  })

  it('increments attempts on each wrong code', async () => {
    await seedOtp()

    await expect(verifyOtp(TEST_PHONE, '000000')).rejects.toThrow()

    const record = await prisma.otpCode.findFirst({ where: { phone: E164 } })
    expect(record!.attempts).toBe(1)
  })

  it('accepts the E.164 format directly', async () => {
    const code = await seedOtp()
    await expect(verifyOtp(E164, code)).resolves.toBeUndefined()
  })
})
