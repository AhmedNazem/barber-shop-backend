import { prisma } from '@/config/prisma'
import { redisClient } from '@/lib/redis'
import { encrypt, decrypt } from '@/lib/crypto'
import { normalisePhone } from '@/lib/sms'
import { AppError } from '@/lib/errors'

const MAINTENANCE_KEY = 'platform:maintenance'
const MAINTENANCE_TTL = 30 // seconds

export async function getPlatformConfig() {
  const row = await prisma.platformConfig.findUnique({ where: { id: 'singleton' } })
  if (!row) {
    return {
      maintenanceMode: false,
      defaultDepositPercent: 20,
      commissionPercent: 10,
      smsProvider: 'unifonic',
      smsSenderId: null,
      smsApiKeyMasked: null,
    }
  }
  return {
    maintenanceMode:       row.maintenanceMode,
    defaultDepositPercent: row.defaultDepositPercent,
    commissionPercent:     row.commissionPercent,
    smsProvider:           row.smsProvider,
    smsSenderId:           row.smsSenderId,
    smsApiKeyMasked:       row.smsApiKeyEncrypted ? '****' : null,
  }
}

export async function updatePlatformConfig(data: {
  maintenanceMode?:       boolean
  defaultDepositPercent?: number
  commissionPercent?:     number
  smsProvider?:           string
  smsApiKey?:             string
  smsSenderId?:           string
}) {
  const { smsApiKey, ...rest } = data
  const updateData: Record<string, unknown> = { ...rest }
  if (smsApiKey !== undefined) {
    updateData['smsApiKeyEncrypted'] = encrypt(smsApiKey)
  }

  await prisma.platformConfig.upsert({
    where:  { id: 'singleton' },
    update: updateData,
    create: { id: 'singleton', ...updateData },
  })

  await redisClient.del(MAINTENANCE_KEY)
}

export async function getMaintenanceMode(): Promise<boolean> {
  const cached = await redisClient.get(MAINTENANCE_KEY)
  if (cached !== null) return cached === '1'

  const row = await prisma.platformConfig.findUnique({
    where:  { id: 'singleton' },
    select: { maintenanceMode: true },
  })
  const value = row?.maintenanceMode ?? false
  await redisClient.set(MAINTENANCE_KEY, value ? '1' : '0', 'EX', MAINTENANCE_TTL)
  return value
}

interface UnifonicResponse {
  Success: boolean
  ErrorCode: string
  ErrorMessage: string
}

export async function testSmsConfig(phone: string) {
  const row = await prisma.platformConfig.findUnique({ where: { id: 'singleton' } })
  if (!row?.smsApiKeyEncrypted) throw new AppError('sms_not_configured', 400)

  const e164   = normalisePhone(phone)
  const apiKey = decrypt(row.smsApiKeyEncrypted)

  if (row.smsProvider !== 'unifonic') {
    throw new AppError('sms_provider_not_supported', 400)
  }

  const resp = await fetch('https://el.cloud.unifonic.com/rest/SMS/messages', {
    method:  'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body:    new URLSearchParams({
      AppSid:       apiKey,
      SenderID:     row.smsSenderId ?? 'BarberOS',
      Body:         'BarberOS test SMS — configuration successful.',
      Recipient:    e164,
      responseType: 'JSON',
    }),
  })

  let body: UnifonicResponse
  try {
    body = (await resp.json()) as UnifonicResponse
  } catch {
    throw new Error(`[SMS] Unifonic returned non-JSON (HTTP ${resp.status})`)
  }

  if (!resp.ok || !body.Success) {
    throw new Error(`[SMS] Unifonic error ${body.ErrorCode}: ${body.ErrorMessage}`)
  }
}
