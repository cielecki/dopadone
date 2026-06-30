/**
 * Config — env-var driven, defaults match plugin.json userConfig defaults.
 *
 * TS parity port of the `# --- Config ---` block in `lib/inject.sh` (#289 F1).
 * Claude Code injects `CLAUDE_PLUGIN_OPTION_*` from the userConfig schema; we fall
 * back to the same defaults so the bundle also runs outside a plugin context (tests,
 * direct invocation). Boundaries are "HH:MM" local-clock strings (minute-granular).
 */
import { homedir } from 'node:os'
import { join } from 'node:path'

export interface Config {
  dopadonePath: string
  workStart: string
  wrapupStart: string
  eveningStart: string
  sleepStart: string
  wrapupIntensity: number
  eveningIntensity: number
  wrapupInterval: number
  overridePhrase: string
  timeMarkerInterval: number
  leaseTtlMinutes: number
  dataDir: string
  retryFile: string
  logFile: string
  protocolFile: string
}

/** Retry window is a hard constant in the bash (not configurable). */
export const RETRY_WINDOW_SEC = 300

function envStr(key: string, fallback: string): string {
  const v = process.env[key]
  return v === undefined || v === '' ? fallback : v
}

function envInt(key: string, fallback: number): number {
  const v = process.env[key]
  if (v === undefined || v === '') return fallback
  const n = Number.parseInt(v, 10)
  return Number.isNaN(n) ? fallback : n
}

/**
 * Resolve the bundled interrupt-protocol doc. Mirrors the bash `HR_PROTOCOL_FILE`
 * (resolved from the script's own location). The shipped bundle lives in `bin/`, so
 * `../references/...` lands at the plugin root; `CLAUDE_PLUGIN_ROOT` wins when set.
 */
function resolveProtocolFile(): string {
  const root = process.env.CLAUDE_PLUGIN_ROOT
  if (root) return join(root, 'references', 'interrupt-protocol.md')
  return join(__dirname, '..', 'references', 'interrupt-protocol.md')
}

export function loadConfig(): Config {
  const dataDir = envStr('CLAUDE_PLUGIN_DATA', join(homedir(), '.claude', 'state'))
  return {
    dopadonePath: envStr('CLAUDE_PLUGIN_OPTION_DOPADONE_PATH', 'dopadone'),
    workStart: envStr('CLAUDE_PLUGIN_OPTION_WORK_START', '07:00'),
    wrapupStart: envStr('CLAUDE_PLUGIN_OPTION_WRAPUP_START', '22:00'),
    eveningStart: envStr('CLAUDE_PLUGIN_OPTION_EVENING_START', '23:00'),
    sleepStart: envStr('CLAUDE_PLUGIN_OPTION_SLEEP_START', '23:30'),
    wrapupIntensity: envInt('CLAUDE_PLUGIN_OPTION_WRAPUP_INTENSITY', 35),
    eveningIntensity: envInt('CLAUDE_PLUGIN_OPTION_EVENING_INTENSITY', 70),
    wrapupInterval: envInt('CLAUDE_PLUGIN_OPTION_WRAPUP_REMINDER_INTERVAL_MINUTES', 15),
    overridePhrase: envStr('CLAUDE_PLUGIN_OPTION_OVERRIDE_PHRASE', 'wiem, override'),
    timeMarkerInterval: envInt('CLAUDE_PLUGIN_OPTION_TIME_MARKER_INTERVAL_MINUTES', 20),
    leaseTtlMinutes: envInt('CLAUDE_PLUGIN_OPTION_INTERRUPT_LEASE_TTL_MINUTES', 60),
    dataDir,
    retryFile: envStr('HR_RETRY_FILE', join(dataDir, 'health-rhythm-retries.txt')),
    logFile: envStr('HR_LOG_FILE', join(dataDir, 'health-rhythm-hook.log')),
    protocolFile: resolveProtocolFile()
  }
}
