import { describe, expect, it } from 'vitest'
import type { Clock } from './clock'
import { buildAdditionalContext, wrapInterrupt, wrapTimeMarker, wrapWrapup } from './emit'

const C: Clock = {
  ymd: '2026-06-15',
  hm: '22:30',
  unixSec: 1781000000,
  minOfDay: 1350,
  hour: 22,
  min: 30
}

describe('XML wrappers', () => {
  it('interrupt carries event/date/time/mode/retry and wraps the directive in newlines', () => {
    expect(wrapInterrupt('BODY', 'sleep', 3, C)).toBe(
      '<dopadone event="interrupt" date="2026-06-15" time="22:30" mode="sleep" retry="3">\nBODY\n</dopadone>'
    )
  })
  it('time-marker is a self-closing tag with no directive', () => {
    expect(wrapTimeMarker(C)).toBe('<dopadone event="time-marker" date="2026-06-15" time="22:30"/>')
  })
  it('wrapup carries event/date/time (no mode/retry)', () => {
    expect(wrapWrapup('NUDGE', C)).toBe(
      '<dopadone event="wrapup" date="2026-06-15" time="22:30">\nNUDGE\n</dopadone>'
    )
  })
})

describe('buildAdditionalContext', () => {
  it('produces the compact UserPromptSubmit envelope', () => {
    const json = buildAdditionalContext('<x/>')
    expect(json).toBe(
      '{"hookSpecificOutput":{"hookEventName":"UserPromptSubmit","additionalContext":"<x/>"}}'
    )
    const parsed = JSON.parse(json)
    expect(parsed.hookSpecificOutput.additionalContext).toBe('<x/>')
  })
})
