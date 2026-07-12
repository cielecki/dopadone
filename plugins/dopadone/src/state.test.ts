import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  claimPath,
  clearClaim,
  overrideQuietPath,
  readClaim,
  recordOverrideQuiet,
  routineMarkerExists,
  sanitizeKey,
  sessionInjectPath,
  withinOverrideQuiet,
  wrapupPath,
  writeClaim,
  writeRoutineMarker
} from './state'

describe('sanitizeKey', () => {
  it('replaces filename-unsafe chars with _', () => {
    expect(sanitizeKey('mode:sleep')).toBe('mode_sleep')
    expect(sanitizeKey('a b/c')).toBe('a_b_c')
    expect(sanitizeKey('Habit-1_ok.v2')).toBe('Habit-1_ok.v2')
  })
})

describe('path builders', () => {
  it('sanitizes the claim/wrapup keys but leaves the raw session id for inject', () => {
    expect(claimPath('/d', 'pomiar:brzucha')).toBe('/d/interrupt-claim-pomiar_brzucha.txt')
    expect(wrapupPath('/d', 'a/b')).toBe('/d/last-wrapup-a_b.txt')
    expect(sessionInjectPath('/d', 'sid-123')).toBe('/d/last-inject-sid-123.txt')
    expect(overrideQuietPath('/d', 'a/b')).toBe('/d/override-quiet-a_b.txt')
  })
})

describe('override quiet window', () => {
  let dir: string
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'hr-oq-'))
  })
  afterEach(() => rmSync(dir, { recursive: true, force: true }))

  it('no window written → not within', () => {
    expect(withinOverrideQuiet(dir, 's1', 1000)).toBe(false)
  })
  it('records an expiry (now + minutes) and honors it until it lapses', () => {
    recordOverrideQuiet(dir, 's1', 1000, 60) // quiet until 1000 + 3600 = 4600
    expect(withinOverrideQuiet(dir, 's1', 1000)).toBe(true)
    expect(withinOverrideQuiet(dir, 's1', 4599)).toBe(true)
    expect(withinOverrideQuiet(dir, 's1', 4600)).toBe(false) // boundary: now < until is false
    expect(withinOverrideQuiet(dir, 's1', 9999)).toBe(false)
  })
  it('is per-session', () => {
    recordOverrideQuiet(dir, 's1', 1000, 60)
    expect(withinOverrideQuiet(dir, 's2', 1000)).toBe(false)
  })
})

describe('claim (lease) + routine marker I/O', () => {
  let dir: string
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'hr-state-'))
  })
  afterEach(() => rmSync(dir, { recursive: true, force: true }))

  it('unclaimed habit reads null', () => {
    expect(readClaim(dir, 'obiad')).toBeNull()
  })
  it('write then read round-trips session + timestamp', () => {
    writeClaim(dir, 'obiad', 's1', 1000)
    expect(readClaim(dir, 'obiad')).toEqual({ sessionId: 's1', ts: 1000 })
  })
  it('a later write hands the lease to a new owner', () => {
    writeClaim(dir, 'obiad', 's1', 1000)
    writeClaim(dir, 'obiad', 's2', 2000)
    expect(readClaim(dir, 'obiad')).toEqual({ sessionId: 's2', ts: 2000 })
  })
  it('clear releases the lease, and is a no-op when already free', () => {
    writeClaim(dir, 'obiad', 's1', 1000)
    clearClaim(dir, 'obiad')
    expect(readClaim(dir, 'obiad')).toBeNull()
    expect(() => clearClaim(dir, 'obiad')).not.toThrow()
  })
  it('routine marker round-trips per session', () => {
    expect(routineMarkerExists(dir, 'sid-1')).toBe(false)
    writeRoutineMarker(dir, 'sid-1')
    expect(routineMarkerExists(dir, 'sid-1')).toBe(true)
    expect(routineMarkerExists(dir, 'sid-2')).toBe(false)
  })
})
