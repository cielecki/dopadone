/**
 * Retry counter — TS parity port of `hr_retry_read/bump/clear` (lib/inject.sh).
 *
 * File format `<unix-ts>|<count>`. Bumped on each block; reset if the file is older
 * than the retry window (300 s) or on a pass-through (clear). Drives the 3/5/10
 * escalation tiers in the directive.
 */
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'
import { RETRY_WINDOW_SEC } from './config'

export interface RetryState {
  ts: number
  count: number
}

/** Parse `<ts>|<count>`; reset to {0,0} if malformed or older than the window. */
export function parseRetry(raw: string, nowSec: number, windowSec = RETRY_WINDOW_SEC): RetryState {
  const firstBar = raw.indexOf('|')
  const tsStr = firstBar === -1 ? raw : raw.slice(0, firstBar)
  const cntStr = raw.slice(raw.lastIndexOf('|') + 1)
  const ts = Number.parseInt(tsStr, 10)
  const count = Number.parseInt(cntStr, 10)
  if (!tsStr || !cntStr || Number.isNaN(ts) || Number.isNaN(count) || nowSec - ts > windowSec) {
    return { ts: 0, count: 0 }
  }
  return { ts, count }
}

export function readRetry(file: string, nowSec: number): RetryState {
  if (!existsSync(file)) return { ts: 0, count: 0 }
  try {
    return parseRetry(readFileSync(file, 'utf8').trim(), nowSec)
  } catch {
    return { ts: 0, count: 0 }
  }
}

/** Increment the counter (within window) and persist; returns the new count. */
export function bumpRetry(file: string, nowSec: number): number {
  const count = readRetry(file, nowSec).count + 1
  mkdirSync(dirname(file), { recursive: true })
  writeFileSync(file, `${nowSec}|${count}`)
  return count
}

export function clearRetry(file: string): void {
  try {
    rmSync(file, { force: true })
  } catch {
    // best-effort — never crash the hook over a stale lock
  }
}
