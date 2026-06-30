/**
 * UserPromptSubmit hook — TS parity port of scripts/user-prompt.sh.
 *
 * Three injection channels (all wrapped in <dopadone> XML): blocking interrupt
 * (probability-gated), non-blocking wrap-up reminder (wrapup phase), and a time-marker.
 * Flow order is load-bearing (extends the original bash with a native subagent gate +
 * a cross-session lease): subagent gate → routine gate → override → agenda fetch → mute →
 * wrap-up channel → blocking channel (+cross-session lease) → time-marker.
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
  clearClaim,
  minutesSinceInject,
  minutesSinceWrapup,
  readClaim,
  recordInject,
  recordWrapup,
  routineMarkerExists,
  writeClaim,
  writeRoutineMarker
} from './state'

export interface HookInput {
  prompt?: string
  session_id?: string
  transcript_path?: string
  /** Native CC field present (truthy) ONLY when the hook fires inside a subagent (verified, binary v2.1.178). */
  agent_id?: string
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

  // --- Subagent gate (interactive-human-only) ---
  // The UPS hook ALSO fires inside Task/Agent subagents, carrying a native `agent_id`
  // (verified in the CC binary, v2.1.178: `agent_id:q?.agentId`). A subagent must never
  // get a health-rhythm injection nor claim a habit lease — it's not the human's chat.
  if (input.agent_id) return

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

  // Cross-session lease ("token") — ONLY for the habit-driven phases (work / wrapup).
  // The same habit reminder must not pile up across parallel chats: the first session to
  // fire CLAIMS the habit; other sessions stay silent while that claim is fresh. The claim
  // releases when its owner takes another turn (so the token can move on), or when it goes
  // stale after leaseTtlMinutes (backstop if the owner abandons that chat).
  const leaseHabitId =
    phase === 'work' || phase === 'wrapup' ? (pickFocusHabit(agenda)?.id ?? '') : ''
  if (leaseHabitId) {
    const claim = readClaim(config.dataDir, leaseHabitId)
    if (claim) {
      if (claim.sessionId === sessionId) {
        clearClaim(config.dataDir, leaseHabitId) // owner's next turn → release the token
      } else if (c.unixSec - claim.ts < config.leaseTtlMinutes * 60) {
        shouldInterrupt = false // another session holds a fresh lease → stay silent
      }
      // else: stale foreign claim → fall through and steal it below
    }
  }

  if (shouldInterrupt) {
    if (leaseHabitId) writeClaim(config.dataDir, leaseHabitId, sessionId, c.unixSec)
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
