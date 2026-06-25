/**
 * Agenda — the `dopadone habits agenda --json` fetch.
 *
 * The wire contract (`AgendaHabit`/`AgendaResponse`) now lives in `@dopadone/core`
 * (#283 — de-duplicated; the CLI emits it, the plugin consumes it). This module owns
 * only the hook-local fetch: it shells out with a 4 s timeout — parity with the bash
 * `hr_get_agenda` (`perl -e 'alarm shift; exec @ARGV' 4 ...`) — and returns null on any
 * failure so the caller stays silent rather than crashing mid-prompt.
 */
import { spawnSync } from 'node:child_process'
import type { AgendaResponse } from '@dopadone/core/habits'

// Re-export so existing local importers (`./agenda`) keep working; canonical def is core's.
export type { AgendaHabit, AgendaResponse } from '@dopadone/core/habits'

/**
 * Run `<dopadonePath> habits agenda --json` with a 4 s timeout. Returns the parsed
 * agenda, or null if the binary is missing, times out, errors, or emits invalid JSON.
 */
export function getAgenda(dopadonePath: string): AgendaResponse | null {
  const res = spawnSync(dopadonePath, ['habits', 'agenda', '--json'], {
    timeout: 4000,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'ignore']
  })
  if (res.error || res.status !== 0 || !res.stdout) return null
  try {
    return JSON.parse(res.stdout) as AgendaResponse
  } catch {
    return null
  }
}
