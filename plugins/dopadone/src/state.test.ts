import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { FocusHabit } from '@dopadone/core/habits'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  cooldownKey,
  cooldownPath,
  minutesSinceInterrupt,
  NEVER_MINUTES,
  recordInterrupt,
  routineMarkerExists,
  sanitizeKey,
  sessionInjectPath,
  wrapupPath,
  writeRoutineMarker
} from './state'

describe('sanitizeKey', () => {
  it('replaces filename-unsafe chars with _', () => {
    expect(sanitizeKey('mode:sleep')).toBe('mode_sleep')
    expect(sanitizeKey('a b/c')).toBe('a_b_c')
    expect(sanitizeKey('Habit-1_ok.v2')).toBe('Habit-1_ok.v2')
  })
})

describe('cooldownKey', () => {
  it('uses the focus id, else a mode sentinel', () => {
    expect(cooldownKey({ id: 'obiad' } as FocusHabit, 'work')).toBe('obiad')
    expect(cooldownKey(null, 'sleep')).toBe('mode:sleep')
  })
})

describe('path builders', () => {
  it('sanitizes the cooldown/wrapup keys but leaves the raw session id for inject', () => {
    expect(cooldownPath('/d', 'mode:sleep')).toBe('/d/interrupt-cooldown-mode_sleep.txt')
    expect(wrapupPath('/d', 'a/b')).toBe('/d/last-wrapup-a_b.txt')
    expect(sessionInjectPath('/d', 'sid-123')).toBe('/d/last-inject-sid-123.txt')
  })
})

describe('cooldown + routine marker I/O', () => {
  let dir: string
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'hr-state-'))
  })
  afterEach(() => rmSync(dir, { recursive: true, force: true }))

  it('never-recorded key reports the NEVER sentinel', () => {
    expect(minutesSinceInterrupt(dir, 'obiad', 1000)).toBe(NEVER_MINUTES)
  })
  it('records and measures minutes since', () => {
    recordInterrupt(dir, 'obiad', 1000)
    expect(minutesSinceInterrupt(dir, 'obiad', 1000 + 120)).toBe(2) // 120s → 2 min
  })
  it('routine marker round-trips per session', () => {
    expect(routineMarkerExists(dir, 'sid-1')).toBe(false)
    writeRoutineMarker(dir, 'sid-1')
    expect(routineMarkerExists(dir, 'sid-1')).toBe(true)
    expect(routineMarkerExists(dir, 'sid-2')).toBe(false)
  })
})
