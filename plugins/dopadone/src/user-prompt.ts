/**
 * UserPromptSubmit hook — TS parity port of scripts/user-prompt.sh.
 *
 * Three injection channels (all wrapped in <dopadone> XML): blocking interrupt
 * (probability-gated), non-blocking wrap-up reminder (wrapup phase), and a time-marker.
 * Flow order is load-bearing and mirrors the bash exactly: routine gate → override →
 * agenda fetch → mute → wrap-up channel → blocking channel (+cooldown) → time-marker.
 *
 * `run()` takes injected clock / agenda-fetcher / RNG so it's deterministically
 * testable; `main()` wires the real stdin + clock + `dopadone` fetch + Math.random.
 */
import { readFileSync } from 'node:fs'
import { finalPct, phaseIdAt, pickFocusHabit } from '@dopadone/core/habits'
import type { AgendaResponse } from './agenda'
import { getAgenda } from './agenda'
import { type Clock, nowClock } from './clock'
import { type Config, loadConfig } from './config'
import { buildInterruptDirective, buildWrapupDirective } from './directive'
import { emitInterrupt, emitTimeMarker, emitWrapup } from './emit'
import { promptOverrides } from './override'
import { bumpRetry, clearRetry } from './retry'
import { detectRoutine, readTranscriptHead } from './routine-gate'
import {
  cooldownKey,
  minutesSinceInject,
  minutesSinceInterrupt,
  minutesSinceWrapup,
  recordInject,
  recordInterrupt,
  recordWrapup,
  routineMarkerExists,
  writeRoutineMarker
} from './state'

export interface HookInput {
  prompt?: string
  session_id?: string
  transcript_path?: string
}

export interface RunOptions {
  input: HookInput
  clock: Clock
  config: Config
  /** Lazy — only invoked after the routine/override gates (parity: bash fetches late). */
  fetchAgenda: () => AgendaResponse | null
  /** Dice roll in [0,100). Default Math.random-based; injected for deterministic tests. */
  rand: () => number
}

export function run(opts: RunOptions): void {
  const { input, clock: c, config, fetchAgenda, rand } = opts
  const promptText = input.prompt ?? ''
  const sessionId = input.session_id ?? 'default'
  const transcriptPath = input.transcript_path ?? ''

  // --- Routine gate (interactive-only) ---
  const transcriptHead = transcriptPath ? readTranscriptHead(transcriptPath) : null
  if (detectRoutine(promptText, transcriptHead)) {
    writeRoutineMarker(config.dataDir, sessionId)
    return
  }
  if (routineMarkerExists(config.dataDir, sessionId)) return

  // --- Override phrase — let through silently and clear retry ---
  if (promptText && promptOverrides(promptText, config.overridePhrase)) {
    clearRetry(config.retryFile)
    return
  }

  const agenda = fetchAgenda()
  if (!agenda) return // dopadone unavailable → never interrupt
  if (agenda.muted != null) {
    clearRetry(config.retryFile)
    return
  }

  const phase = phaseIdAt(c.minOfDay, config)

  // --- Wrap-up phase: non-blocking reminder channel (own cadence + intensity) ---
  if (phase === 'wrapup' && config.wrapupIntensity > 0 && config.wrapupInterval >= 0) {
    if (minutesSinceWrapup(config.dataDir, sessionId, c.unixSec) >= config.wrapupInterval) {
      if (rand() < config.wrapupIntensity) {
        emitWrapup(buildWrapupDirective(config), c, config.logFile)
        recordWrapup(config.dataDir, sessionId, c.unixSec)
        recordInject(config.dataDir, sessionId, c.unixSec)
        return
      }
    }
  }

  // --- Blocking interrupt channel (habit urgency + evening/sleep baseline) ---
  const p = finalPct(agenda, phase, config.eveningIntensity)
  let shouldInterrupt = p > 0 && rand() < p

  // Cross-session cooldown gate — ONLY in the habit-driven phases (work / wrapup).
  let cdKey = ''
  if (
    shouldInterrupt &&
    config.interruptCooldownMinutes > 0 &&
    (phase === 'work' || phase === 'wrapup')
  ) {
    cdKey = cooldownKey(pickFocusHabit(agenda), phase)
    if (minutesSinceInterrupt(config.dataDir, cdKey, c.unixSec) < config.interruptCooldownMinutes) {
      shouldInterrupt = false
    }
  }

  if (shouldInterrupt) {
    if (cdKey) recordInterrupt(config.dataDir, cdKey, c.unixSec)
    const retry = bumpRetry(config.retryFile, c.unixSec)
    emitInterrupt(
      buildInterruptDirective(config, agenda, phase, retry),
      phase,
      retry,
      c,
      config.logFile
    )
    recordInject(config.dataDir, sessionId, c.unixSec)
    return
  }

  // No interrupt this turn — clear retry, then maybe emit a time-marker.
  clearRetry(config.retryFile)
  if (minutesSinceInject(config.dataDir, sessionId, c.unixSec) >= config.timeMarkerInterval) {
    emitTimeMarker(c, config.logFile)
    recordInject(config.dataDir, sessionId, c.unixSec)
  }
}

function parseStdin(): HookInput {
  let raw = ''
  try {
    raw = readFileSync(0, 'utf8')
  } catch {
    raw = ''
  }
  try {
    return JSON.parse(raw) as HookInput
  } catch {
    return {}
  }
}

export function main(): void {
  const config = loadConfig()
  run({
    input: parseStdin(),
    clock: nowClock(),
    config,
    fetchAgenda: () => getAgenda(config.dopadonePath),
    rand: () => Math.floor(Math.random() * 100)
  })
}
