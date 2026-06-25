import { describe, expect, it } from 'vitest'
import { clockFrom } from './clock'

describe('clockFrom', () => {
  it('derives local YMD/HM/minOfDay from a Date', () => {
    const d = new Date(2026, 5, 15, 22, 30, 0) // local 2026-06-15 22:30
    const c = clockFrom(d)
    expect(c.ymd).toBe('2026-06-15')
    expect(c.hm).toBe('22:30')
    expect(c.hour).toBe(22)
    expect(c.min).toBe(30)
    expect(c.minOfDay).toBe(22 * 60 + 30)
    expect(c.unixSec).toBe(Math.floor(d.getTime() / 1000))
  })
  it('zero-pads single digits', () => {
    const c = clockFrom(new Date(2026, 0, 5, 7, 5, 0))
    expect(c.ymd).toBe('2026-01-05')
    expect(c.hm).toBe('07:05')
  })
})
