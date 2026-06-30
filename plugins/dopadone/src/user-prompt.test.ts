import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { AgendaResponse } from './agenda'
import { clockFrom } from './clock'
import type { Config } from './config'
import { readClaim, routineMarkerExists } from './state'
import { run } from './user-prompt'

function makeConfig(dir: string): Config {
  return {
    dopadonePath: 'dopadone',
    workStart: '07:00',
    wrapupStart: '22:00',
    eveningStart: '23:00',
    sleepStart: '23:30',
    wrapupIntensity: 35,
    eveningIntensity: 70,
    wrapupInterval: 15,
    overridePhrase: 'wiem, override',
    timeMarkerInterval: 20,
    leaseTtlMinutes: 60,
    dataDir: dir,
    retryFile: join(dir, 'retries.txt'),
    logFile: join(dir, 'hook.log'),
    protocolFile: '/p/references/interrupt-protocol.md'
  }
}

function agenda(over: Partial<AgendaResponse> = {}): AgendaResponse {
  return {
    now: '2026-06-15T13:00:00.000Z',
    muted: null,
    habits: [
      {
        id: 'obiad',
        content: 'Obiad',
        description: '',
        priority: 8,
        kind: 'open-todo',
        isOpen: true,
        snoozed: null,
        timeWindow: { start_minutes: 780, linger_minutes: 0 },
        lingerElapsedMinutes: null,
        occurrenceDate: '2026-06-15',
        nextEligibleAt: null
      }
    ],
    summary: { openNow: ['obiad'], missedToday: [], snoozed: [], upcomingWithinHour: [] },
    ...over
  }
}

const SLEEP = clockFrom(new Date(2026, 5, 15, 23, 45, 0))
const WORK = clockFrom(new Date(2026, 5, 15, 13, 0, 0))

describe('run (integration)', () => {
  let dir: string
  let writes: string[]
  // biome-ignore lint/suspicious/noExplicitAny: spy handle
  let spy: any
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'hr-run-'))
    writes = []
    spy = vi.spyOn(process.stdout, 'write').mockImplementation((s: string | Uint8Array) => {
      writes.push(String(s))
      return true
    })
  })
  afterEach(() => {
    spy.mockRestore()
    rmSync(dir, { recursive: true, force: true })
  })
  const out = () => writes.join('')
  // Decode the emitted hook JSON to its additionalContext payload (quotes are escaped in the raw JSON).
  const ctx = () => {
    const o = out()
    if (!o) return ''
    try {
      return JSON.parse(o).hookSpecificOutput.additionalContext as string
    } catch {
      return o
    }
  }

  it('routine prompt → silent + marker, and the marker silences the rest of the session', () => {
    const cfg = makeConfig(dir)
    run({
      input: { prompt: '<scheduled-task name="dream">', session_id: 's1' },
      clock: WORK,
      config: cfg,
      fetchAgenda: () => agenda(),
      rand: () => 0
    })
    expect(out()).toBe('')
    expect(routineMarkerExists(dir, 's1')).toBe(true)
    run({
      input: { prompt: 'a normal interactive prompt', session_id: 's1' },
      clock: WORK,
      config: cfg,
      fetchAgenda: () => agenda(),
      rand: () => 0
    })
    expect(out()).toBe('')
  })

  it('override phrase → silent', () => {
    run({
      input: { prompt: 'wiem, override', session_id: 's1' },
      clock: WORK,
      config: makeConfig(dir),
      fetchAgenda: () => agenda(),
      rand: () => 0
    })
    expect(out()).toBe('')
  })

  it('muted agenda → silent', () => {
    run({
      input: { prompt: 'hi', session_id: 's1' },
      clock: WORK,
      config: makeConfig(dir),
      fetchAgenda: () => agenda({ muted: { until: 'x', reason: '' } }),
      rand: () => 0
    })
    expect(out()).toBe('')
  })

  it('sleep phase always interrupts (p forced to 100, even on a high roll)', () => {
    run({
      input: { prompt: 'hi', session_id: 's1' },
      clock: SLEEP,
      config: makeConfig(dir),
      fetchAgenda: () => agenda(),
      rand: () => 99
    })
    expect(ctx()).toContain('event="interrupt"')
    expect(ctx()).toContain('mode="sleep"')
  })

  it('work: dice hit → habit interrupt', () => {
    run({
      input: { prompt: 'hi', session_id: 's1' },
      clock: WORK,
      config: makeConfig(dir),
      fetchAgenda: () => agenda(),
      rand: () => 0
    })
    expect(ctx()).toContain('event="interrupt"')
    expect(ctx()).toContain('mode="work"')
  })

  it('work lease: a fresh claim by s1 silences the same habit interrupt in s2', () => {
    const cfg = makeConfig(dir)
    run({
      input: { prompt: 'hi', session_id: 's1' },
      clock: WORK,
      config: cfg,
      fetchAgenda: () => agenda(),
      rand: () => 0
    })
    expect(ctx()).toContain('event="interrupt"') // s1 fires and claims the obiad lease
    writes.length = 0
    run({
      input: { prompt: 'hi', session_id: 's2' },
      clock: WORK,
      config: cfg,
      fetchAgenda: () => agenda(),
      rand: () => 0
    })
    expect(out()).not.toContain('event="interrupt"') // s2 silenced by s1's fresh lease
  })

  it('work lease: the owner is never blocked by its own claim (releases + re-claims)', () => {
    const cfg = makeConfig(dir)
    const fire = (sid: string) =>
      run({
        input: { prompt: 'hi', session_id: sid },
        clock: WORK,
        config: cfg,
        fetchAgenda: () => agenda(),
        rand: () => 0
      })
    fire('s1')
    writes.length = 0
    fire('s1')
    expect(ctx()).toContain('event="interrupt"')
  })

  it('work lease: a non-firing owner turn releases the token, letting s2 claim next', () => {
    const cfg = makeConfig(dir)
    run({
      input: { prompt: 'hi', session_id: 's1' },
      clock: WORK,
      config: cfg,
      fetchAgenda: () => agenda(),
      rand: () => 0
    }) // s1 claims
    run({
      input: { prompt: 'hi', session_id: 's1' },
      clock: WORK,
      config: cfg,
      fetchAgenda: () => agenda(),
      rand: () => 99
    }) // owner's turn, dice miss → release, no re-claim
    expect(readClaim(dir, 'obiad')).toBeNull()
    writes.length = 0
    run({
      input: { prompt: 'hi', session_id: 's2' },
      clock: WORK,
      config: cfg,
      fetchAgenda: () => agenda(),
      rand: () => 0
    })
    expect(ctx()).toContain('event="interrupt"') // s2 free to claim + fire
  })

  it('work lease: a stale foreign claim is stolen after the TTL, a fresh one is not', () => {
    const cfg = makeConfig(dir)
    run({
      input: { prompt: 'hi', session_id: 's1' },
      clock: WORK,
      config: cfg,
      fetchAgenda: () => agenda(),
      rand: () => 0
    }) // s1 claims at 13:00
    writes.length = 0
    run({
      input: { prompt: 'hi', session_id: 's2' },
      clock: clockFrom(new Date(2026, 5, 15, 13, 30, 0)),
      config: cfg,
      fetchAgenda: () => agenda(),
      rand: () => 0
    })
    expect(out()).not.toContain('event="interrupt"') // 30 min: fresh → suppressed
    writes.length = 0
    run({
      input: { prompt: 'hi', session_id: 's2' },
      clock: clockFrom(new Date(2026, 5, 15, 14, 1, 0)),
      config: cfg,
      fetchAgenda: () => agenda(),
      rand: () => 0
    })
    expect(ctx()).toContain('event="interrupt"') // 61 min: stale → stolen
  })

  it('subagent (agent_id present) → fully silent, claims nothing', () => {
    const cfg = makeConfig(dir)
    run({
      input: { prompt: 'hi', session_id: 's1', agent_id: 'sub-abc' },
      clock: WORK,
      config: cfg,
      fetchAgenda: () => agenda(),
      rand: () => 0
    })
    expect(out()).toBe('')
    expect(readClaim(dir, 'obiad')).toBeNull()
  })

  it('no interrupt + fresh session → time-marker', () => {
    run({
      input: { prompt: 'hi', session_id: 's1' },
      clock: WORK,
      config: makeConfig(dir),
      fetchAgenda: () => agenda(), // priority 8 → p=24
      rand: () => 50 // 50 ≥ 24 → no interrupt
    })
    expect(ctx()).toContain('event="time-marker"')
  })
})
