import { describe, expect, it } from 'vitest'
import type { AgendaHabit, AgendaResponse } from './agenda'
import type { Config } from './config'
import { buildInterruptDirective, buildWrapupDirective } from './directive'

const config = {
  dopadonePath: 'dopadone',
  workStart: '07:00',
  wrapupStart: '22:00',
  eveningStart: '23:00',
  sleepStart: '23:30',
  eveningIntensity: 70,
  overridePhrase: 'wiem, override',
  protocolFile: '/plugin/references/interrupt-protocol.md'
} as Config

function habit(over: Partial<AgendaHabit> = {}): AgendaHabit {
  return {
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
    nextEligibleAt: null,
    ...over
  }
}

function agenda(habits: AgendaHabit[]): AgendaResponse {
  return {
    now: '2026-06-15T13:00:00.000Z',
    muted: null,
    habits,
    summary: {
      openNow: habits.map((h) => h.id),
      missedToday: [],
      snoozed: [],
      upcomingWithinHour: []
    }
  }
}

describe('buildInterruptDirective — evening', () => {
  const d = buildInterruptDirective(config, agenda([]), 'evening', 1)
  it('is the inline wind-down/persuasion script', () => {
    expect(d).toContain('faza: rutyna wieczorna, próba 1')
    expect(d).toContain('Po 23:00 — koniec pracy')
    expect(d).toContain('wiem, override')
    expect(d).not.toContain('interrupt-protocol.md') // inline, no protocol pointer
  })
})

describe('buildInterruptDirective — sleep', () => {
  const d = buildInterruptDirective(config, agenda([]), 'sleep', 2)
  it('is the inline near-total refusal', () => {
    expect(d).toContain('faza: sen, próba 2')
    expect(d).toContain('Po 23:30 (do 07:00)')
    expect(d).toContain('wiem, override')
  })
})

describe('buildInterruptDirective — work (habit anchor)', () => {
  it('names the focus habit + the action grammar, points at the protocol', () => {
    const d = buildInterruptDirective(config, agenda([habit()]), 'work', 1)
    expect(d).toContain('faza: work, próba 1')
    expect(d).toContain('Użytkownik powinien teraz wykonać nawyk: "Obiad" (ID: obiad)')
    expect(d).toContain('dopadone habits done obiad')
    expect(d).toContain('dopadone plan move obiad')
    expect(d).not.toContain('habits snooze') // #281/#289 migrated off the deprecated surface
    expect(d).toContain('dopadone habits decline obiad')
    expect(d).toContain('/plugin/references/interrupt-protocol.md')
  })
  it('omits the Opis line when description is empty, includes it otherwise', () => {
    const plain = buildInterruptDirective(config, agenda([habit()]), 'work', 1)
    expect(plain).not.toContain('Opis:')
    const withDesc = buildInterruptDirective(
      config,
      agenda([habit({ description: 'zapisz do dziennika' })]),
      'work',
      1
    )
    expect(withDesc).toContain('Opis: "zapisz do dziennika"')
    expect(withDesc).toContain('instrukcja dla Ciebie')
  })
  it('escalates at retry tiers 3 / 5 / 10', () => {
    const a = agenda([habit()])
    expect(buildInterruptDirective(config, a, 'work', 3)).toContain('jeśli to NAPRAWDĘ pilne')
    expect(buildInterruptDirective(config, a, 'work', 5)).toContain('habits mute --until <czas>')
    expect(buildInterruptDirective(config, a, 'work', 10)).toContain('habits mute --until 07:00')
  })
  it('falls back to a generic line when no habit is open', () => {
    const d = buildInterruptDirective(config, agenda([]), 'work', 1)
    expect(d).toContain('Brak konkretnego nawyku')
  })
  it('does not end with a trailing newline (command-sub parity)', () => {
    expect(buildInterruptDirective(config, agenda([habit()]), 'work', 1).endsWith('\n')).toBe(false)
  })
})

describe('buildWrapupDirective', () => {
  it('is the non-blocking answer-then-nudge directive', () => {
    const d = buildWrapupDirective(config)
    expect(d).toContain('DOPADONE WRAP-UP')
    expect(d).toContain('To NIE jest blokada')
    expect(d).toContain('po 22:00')
  })
})
