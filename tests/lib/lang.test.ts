import { describe, it, expect } from 'vitest'
import { getLang } from '@/lib/lang'
import type { Request } from 'express'

function makeReq(query: Record<string, string> = {}, acceptLanguage = ''): Request {
  return {
    query,
    headers: { 'accept-language': acceptLanguage },
  } as unknown as Request
}

describe('getLang', () => {
  it('returns "en" when ?lang=en', () => {
    expect(getLang(makeReq({ lang: 'en' }))).toBe('en')
  })

  it('returns "ar" when ?lang=ar', () => {
    expect(getLang(makeReq({ lang: 'ar' }))).toBe('ar')
  })

  it('ignores invalid ?lang value and falls back to header', () => {
    expect(getLang(makeReq({ lang: 'fr' }, 'ar-IQ'))).toBe('ar')
  })

  it('returns "ar" when Accept-Language starts with ar', () => {
    expect(getLang(makeReq({}, 'ar-IQ,ar;q=0.9'))).toBe('ar')
  })

  it('returns "ar" when Accept-Language is something else (default is ar)', () => {
    expect(getLang(makeReq({}, 'fr-FR'))).toBe('ar')
  })

  it('returns "ar" when no lang param and no header (default is ar)', () => {
    expect(getLang(makeReq())).toBe('ar')
  })

  it('?lang param takes priority over Accept-Language header', () => {
    expect(getLang(makeReq({ lang: 'en' }, 'ar-IQ'))).toBe('en')
  })
})
