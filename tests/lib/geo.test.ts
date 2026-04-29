import { describe, it, expect } from 'vitest'
import { haversineMeters } from '@/lib/geo'

describe('haversineMeters', () => {
  it('returns 0 for identical coordinates', () => {
    expect(haversineMeters(33.3, 44.4, 33.3, 44.4)).toBe(0)
  })

  it('returns ~111km per degree of latitude', () => {
    const meters = haversineMeters(0, 0, 1, 0)
    expect(meters).toBeGreaterThan(110_000)
    expect(meters).toBeLessThan(112_000)
  })

  it('Baghdad to Basra straight-line is roughly 448km', () => {
    // Baghdad: 33.34, 44.40 — Basra: 30.51, 47.78
    const meters = haversineMeters(33.34, 44.4, 30.51, 47.78)
    expect(meters).toBeGreaterThan(430_000)
    expect(meters).toBeLessThan(470_000)
  })
})
