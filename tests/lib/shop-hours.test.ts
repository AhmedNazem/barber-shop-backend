import { describe, it, expect } from 'vitest'
import { isShopOpen } from '@/lib/shop-hours'

// dayOfWeek: 0=Sun,1=Mon,2=Tue,3=Wed,4=Thu,5=Fri,6=Sat
const hours = [
  { dayOfWeek: 1, openTime: '09:00', closeTime: '18:00', isClosed: false }, // Monday open
  { dayOfWeek: 2, openTime: '09:00', closeTime: '18:00', isClosed: false }, // Tuesday open
  { dayOfWeek: 6, openTime: '00:00', closeTime: '00:00', isClosed: true },  // Saturday closed
]

// Baghdad is UTC+3. To get Baghdad 10:00 Mon, use UTC 07:00 Mon.
// 2026-01-05 is a Monday.
const mon10am = new Date('2026-01-05T07:00:00Z') // Baghdad: Mon 10:00
const mon08am = new Date('2026-01-05T05:00:00Z') // Baghdad: Mon 08:00 (before open)
const mon20pm = new Date('2026-01-05T17:00:00Z') // Baghdad: Mon 20:00 (after close)
const sat10am = new Date('2026-01-10T07:00:00Z') // Baghdad: Sat 10:00 (closed day)
const sun10am = new Date('2026-01-11T07:00:00Z') // Baghdad: Sun 10:00 (no hours entry)

describe('isShopOpen', () => {
  it('returns true when current time is within open hours', () => {
    expect(isShopOpen(hours, mon10am)).toBe(true)
  })

  it('returns false before opening time', () => {
    expect(isShopOpen(hours, mon08am)).toBe(false)
  })

  it('returns false after closing time', () => {
    expect(isShopOpen(hours, mon20pm)).toBe(false)
  })

  it('returns false when isClosed is true for that day', () => {
    expect(isShopOpen(hours, sat10am)).toBe(false)
  })

  it('returns false when no hours entry exists for that day', () => {
    expect(isShopOpen(hours, sun10am)).toBe(false)
  })
})
