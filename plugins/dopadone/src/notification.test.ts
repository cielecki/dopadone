import { describe, expect, it } from 'vitest'
import { clockFrom } from './clock'
import type { Config } from './config'
import { computeNotification, notifDedupKey } from './notification'

const config = {
  workStart: '07:00',
  wrapupStart: '22:00',
  eveningStart: '23:00',
  sleepStart: '23:30'
} as Config

function at(h: number, m: number) {
  return clockFrom(new Date(2026, 5, 15, h, m, 0))
}

describe('computeNotification', () => {
  it('fires meal windows near the top of the hour', () => {
    expect(computeNotification(at(8, 5), config)?.title).toBe('Śniadanie')
    expect(computeNotification(at(13, 10), config)?.title).toBe('Obiad')
    expect(computeNotification(at(18, 0), config)?.title).toBe('Kolacja')
  })
  it('does not fire a meal window past min 15', () => {
    expect(computeNotification(at(8, 20), config)).toBeNull()
  })
  it('fires phase boundaries within 15 min after the mark', () => {
    expect(computeNotification(at(22, 5), config)?.title).toBe('Zwijanie dnia')
    expect(computeNotification(at(23, 5), config)?.title).toBe('Wieczorna rutyna')
  })
  it('fires the 10-min sleep warning before sleep_start', () => {
    expect(computeNotification(at(23, 20), config)?.title).toBe('Sen za 10 min')
  })
  it('is silent at a quiet time', () => {
    expect(computeNotification(at(10, 30), config)).toBeNull()
  })
})

describe('notifDedupKey', () => {
  it('keys per date-hour-title so two boundaries in one hour each fire once', () => {
    expect(notifDedupKey(at(23, 5), 'Wieczorna rutyna')).toBe('2026-06-15-23-Wieczorna rutyna')
    expect(notifDedupKey(at(23, 20), 'Sen za 10 min')).toBe('2026-06-15-23-Sen za 10 min')
  })
})
