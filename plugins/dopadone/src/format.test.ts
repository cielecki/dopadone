import { describe, expect, it } from 'vitest'
import { fmtDur } from './format'

describe('fmtDur', () => {
  it('renders the same buckets as the bash hr_fmt_dur', () => {
    expect(fmtDur(0)).toBe('<1m')
    expect(fmtDur(0.4)).toBe('<1m')
    expect(fmtDur(1)).toBe('1m')
    expect(fmtDur(59)).toBe('59m')
    expect(fmtDur(60)).toBe('1h')
    expect(fmtDur(90)).toBe('1h 30m')
    expect(fmtDur(120)).toBe('2h')
    expect(fmtDur(125)).toBe('2h 5m')
  })
})
