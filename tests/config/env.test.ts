import { describe, it, expect } from 'vitest'
import { validateEnv } from '@/config/env'

// Valid baseline comes from .env.test — no secrets hardcoded here
const valid: Record<string, string | undefined> = {
  NODE_ENV: process.env['NODE_ENV'],
  PORT: process.env['PORT'],
  DATABASE_URL: process.env['DATABASE_URL'],
  JWT_SECRET: process.env['JWT_SECRET'],
  JWT_REFRESH_SECRET: process.env['JWT_REFRESH_SECRET'],
  ENCRYPTION_KEY: process.env['ENCRYPTION_KEY'],
  REDIS_URL: process.env['REDIS_URL'],
  CORS_ORIGIN: process.env['CORS_ORIGIN'],
}

describe('validateEnv', () => {
  it('passes with all required vars present', () => {
    expect(() => validateEnv(valid)).not.toThrow()
  })

  it('applies defaults for PORT and NODE_ENV when omitted', () => {
    const { PORT, NODE_ENV, ...rest } = valid
    const result = validateEnv(rest)
    expect(result.PORT).toBe(4000)
    expect(result.NODE_ENV).toBe('development')
  })

  it('throws when DATABASE_URL is missing', () => {
    const { DATABASE_URL, ...rest } = valid
    expect(() => validateEnv(rest)).toThrow('DATABASE_URL')
  })

  it('throws when JWT_SECRET is too short', () => {
    expect(() => validateEnv({ ...valid, JWT_SECRET: 'tooshort' })).toThrow('JWT_SECRET')
  })

  it('throws when JWT_REFRESH_SECRET is too short', () => {
    expect(() => validateEnv({ ...valid, JWT_REFRESH_SECRET: 'tooshort' })).toThrow('JWT_REFRESH_SECRET')
  })

  it('throws when ENCRYPTION_KEY is not exactly 32 chars', () => {
    expect(() => validateEnv({ ...valid, ENCRYPTION_KEY: 'tooshort' })).toThrow('ENCRYPTION_KEY')
    expect(() => validateEnv({ ...valid, ENCRYPTION_KEY: 'a'.repeat(33) })).toThrow('ENCRYPTION_KEY')
  })

  it('throws when REDIS_URL is missing', () => {
    const { REDIS_URL, ...rest } = valid
    expect(() => validateEnv(rest)).toThrow('REDIS_URL')
  })

  it('throws when CORS_ORIGIN is not a valid URL', () => {
    expect(() => validateEnv({ ...valid, CORS_ORIGIN: 'not-a-url' })).toThrow('CORS_ORIGIN')
  })

  it('accepts optional fields when provided', () => {
    const result = validateEnv({ ...valid, SMS_PROVIDER: 'unifonic', AWS_BUCKET_NAME: 'my-bucket' })
    expect(result.SMS_PROVIDER).toBe('unifonic')
    expect(result.AWS_BUCKET_NAME).toBe('my-bucket')
  })
})
