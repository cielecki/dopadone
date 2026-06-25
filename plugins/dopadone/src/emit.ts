/**
 * JSON emitters — TS parity port of `hr_emit_interrupt` / `hr_emit_time_marker` /
 * `hr_emit_wrapup` (lib/inject.sh). Each wraps the directive in a `<dopadone>`
 * XML tag, logs `<unix-ts> <json>` to the hook log, and writes the UserPromptSubmit
 * additionalContext JSON to stdout.
 */
import { appendFileSync, mkdirSync } from 'node:fs'
import { dirname } from 'node:path'
import type { Clock } from './clock'

/** The hookSpecificOutput envelope Claude Code reads from stdout. Compact JSON. */
export function buildAdditionalContext(wrapped: string): string {
  return JSON.stringify({
    hookSpecificOutput: {
      hookEventName: 'UserPromptSubmit',
      additionalContext: wrapped
    }
  })
}

export function wrapInterrupt(directive: string, mode: string, retry: number, c: Clock): string {
  return `<dopadone event="interrupt" date="${c.ymd}" time="${c.hm}" mode="${mode}" retry="${retry}">\n${directive}\n</dopadone>`
}

export function wrapTimeMarker(c: Clock): string {
  return `<dopadone event="time-marker" date="${c.ymd}" time="${c.hm}"/>`
}

export function wrapWrapup(directive: string, c: Clock): string {
  return `<dopadone event="wrapup" date="${c.ymd}" time="${c.hm}">\n${directive}\n</dopadone>`
}

function logAndPrint(json: string, logFile: string, unixSec: number): void {
  try {
    mkdirSync(dirname(logFile), { recursive: true })
    appendFileSync(logFile, `${unixSec} ${json}\n`)
  } catch {
    // best-effort logging — never crash the hook over a log write
  }
  process.stdout.write(json)
}

export function emitInterrupt(
  directive: string,
  mode: string,
  retry: number,
  c: Clock,
  logFile: string
): void {
  logAndPrint(buildAdditionalContext(wrapInterrupt(directive, mode, retry, c)), logFile, c.unixSec)
}

export function emitTimeMarker(c: Clock, logFile: string): void {
  logAndPrint(buildAdditionalContext(wrapTimeMarker(c)), logFile, c.unixSec)
}

export function emitWrapup(directive: string, c: Clock, logFile: string): void {
  logAndPrint(buildAdditionalContext(wrapWrapup(directive, c)), logFile, c.unixSec)
}
