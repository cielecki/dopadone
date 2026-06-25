/**
 * Per-session / cross-session state files — TS parity port of the state helpers in
 * lib/inject.sh (`hr_sanitize_key`, the *_path / hr_minutes_since_* / hr_record_*
 * functions, `hr_cooldown_key`).
 *
 * All timestamps are unix seconds, one per file. Missing file → "never" (999999 min).
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import type { FocusHabit } from '@dopadone/core/habits'

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
// `hr_session_state_path` does NOT sanitize it (only wrapup/cooldown/routine do).
// Session ids are filename-safe UUIDs, so this is parity-preserving in practice.
export function sessionInjectPath(dataDir: string, sid: string): string {
  return join(dataDir, `last-inject-${sid}.txt`)
}
export function wrapupPath(dataDir: string, sid: string): string {
  return join(dataDir, `last-wrapup-${sanitizeKey(sid)}.txt`)
}
export function cooldownPath(dataDir: string, key: string): string {
  return join(dataDir, `interrupt-cooldown-${sanitizeKey(key)}.txt`)
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
export function minutesSinceInterrupt(dataDir: string, key: string, nowSec: number): number {
  return minutesSince(cooldownPath(dataDir, key), nowSec)
}
export function recordInterrupt(dataDir: string, key: string, nowSec: number): void {
  writeTs(cooldownPath(dataDir, key), nowSec)
}

/** Cooldown key: the focus habit's id, else a `mode:<phase>` sentinel. */
export function cooldownKey(focus: FocusHabit | null, mode: string): string {
  return focus ? focus.id : `mode:${mode}`
}

/** Write the empty per-session routine marker (silences the plugin for the session). */
export function writeRoutineMarker(dataDir: string, sid: string): void {
  mkdirSync(dataDir, { recursive: true })
  writeFileSync(routineMarkerPath(dataDir, sid), '')
}
export function routineMarkerExists(dataDir: string, sid: string): boolean {
  return existsSync(routineMarkerPath(dataDir, sid))
}
