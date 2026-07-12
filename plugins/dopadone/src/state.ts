/**
 * Per-session / cross-session state files — TS parity port of the state helpers in
 * lib/inject.sh (`hr_sanitize_key`, the *_path / hr_minutes_since_* / hr_record_*
 * functions). The legacy cross-session interrupt cooldown gave way to a per-habit
 * lease (claim) in v2.5.1.
 *
 * All timestamps are unix seconds, one per file. Missing file → "never" (999999 min).
 */

import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'

/** Sentinel "minutes since" when a state file has never been written. */
export const NEVER_MINUTES = 999999

/** Replace any char outside [A-Za-z0-9._-] with '_' (filename-safe key). */
export function sanitizeKey(s: string): string {
  return s.replace(/[^A-Za-z0-9._-]/g, '_')
}

function readTs(file: string): number | null {
  if (!existsSync(file)) return null
  try {
    return Number.parseInt(readFileSync(file, 'utf8').trim(), 10) || 0
  } catch {
    return 0
  }
}

function writeTs(file: string, nowSec: number): void {
  mkdirSync(dirname(file), { recursive: true })
  writeFileSync(file, String(nowSec))
}

function minutesSince(file: string, nowSec: number): number {
  const last = readTs(file)
  if (last === null) return NEVER_MINUTES
  return Math.floor((nowSec - last) / 60)
}

// NOTE: the per-session inject path uses the RAW session id — the bash
// `hr_session_state_path` does NOT sanitize it (only wrapup/claim/routine do).
// Session ids are filename-safe UUIDs, so this is parity-preserving in practice.
export function sessionInjectPath(dataDir: string, sid: string): string {
  return join(dataDir, `last-inject-${sid}.txt`)
}
export function wrapupPath(dataDir: string, sid: string): string {
  return join(dataDir, `last-wrapup-${sanitizeKey(sid)}.txt`)
}
export function claimPath(dataDir: string, habitId: string): string {
  return join(dataDir, `interrupt-claim-${sanitizeKey(habitId)}.txt`)
}
export function routineMarkerPath(dataDir: string, sid: string): string {
  return join(dataDir, `routine-session-${sanitizeKey(sid)}.txt`)
}

export function minutesSinceInject(dataDir: string, sid: string, nowSec: number): number {
  return minutesSince(sessionInjectPath(dataDir, sid), nowSec)
}
export function recordInject(dataDir: string, sid: string, nowSec: number): void {
  writeTs(sessionInjectPath(dataDir, sid), nowSec)
}
export function minutesSinceWrapup(dataDir: string, sid: string, nowSec: number): number {
  return minutesSince(wrapupPath(dataDir, sid), nowSec)
}
export function recordWrapup(dataDir: string, sid: string, nowSec: number): void {
  writeTs(wrapupPath(dataDir, sid), nowSec)
}
/** A cross-session interrupt lease: which session currently owns reminding for a habit, and when it claimed it. */
export interface Claim {
  sessionId: string
  ts: number
}

/** Read the current lease for a habit; null if unclaimed or unreadable. */
export function readClaim(dataDir: string, habitId: string): Claim | null {
  const file = claimPath(dataDir, habitId)
  if (!existsSync(file)) return null
  try {
    const o = JSON.parse(readFileSync(file, 'utf8')) as Partial<Claim>
    return typeof o.sessionId === 'string' && typeof o.ts === 'number'
      ? { sessionId: o.sessionId, ts: o.ts }
      : null
  } catch {
    return null
  }
}

/** Claim (or refresh) the lease for a habit on behalf of a session. */
export function writeClaim(
  dataDir: string,
  habitId: string,
  sessionId: string,
  nowSec: number
): void {
  const file = claimPath(dataDir, habitId)
  mkdirSync(dirname(file), { recursive: true })
  writeFileSync(file, JSON.stringify({ sessionId, ts: nowSec }))
}

/** Release the lease for a habit (no-op if already free). */
export function clearClaim(dataDir: string, habitId: string): void {
  try {
    rmSync(claimPath(dataDir, habitId), { force: true })
  } catch {
    // best-effort release
  }
}

/** Write the empty per-session routine marker (silences the plugin for the session). */
export function writeRoutineMarker(dataDir: string, sid: string): void {
  mkdirSync(dataDir, { recursive: true })
  writeFileSync(routineMarkerPath(dataDir, sid), '')
}
export function routineMarkerExists(dataDir: string, sid: string): boolean {
  return existsSync(routineMarkerPath(dataDir, sid))
}

// --- Override quiet window ---
// After the override phrase is used during a night phase, this session stays FULLY silent
// (no interrupt, no time-marker) until the stored expiry — so a deliberate night work
// session isn't re-interrupted every single turn (the context-pollution that made
// overriding-then-working ineffective). Unlike the "last event" files above, this stores
// the EXPIRY unix-sec (now + minutes*60), not the event time.
export function overrideQuietPath(dataDir: string, sid: string): string {
  return join(dataDir, `override-quiet-${sanitizeKey(sid)}.txt`)
}
/** True if this session is inside an active override-granted quiet window. */
export function withinOverrideQuiet(dataDir: string, sid: string, nowSec: number): boolean {
  const until = readTs(overrideQuietPath(dataDir, sid))
  return until !== null && nowSec < until
}
/** Start/refresh the quiet window: silent until now + `minutes`. */
export function recordOverrideQuiet(
  dataDir: string,
  sid: string,
  nowSec: number,
  minutes: number
): void {
  writeTs(overrideQuietPath(dataDir, sid), nowSec + minutes * 60)
}
