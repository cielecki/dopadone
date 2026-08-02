/**
 * Notification hook — TS parity port of scripts/notification.sh. OS desktop
 * notification at meal-window openings and phase/sleep boundaries, with per-boundary
 * hourly dedup. Fires whenever Claude is idle / awaiting input.
 */
import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { hmToMin } from '@dopadone/core/habits'
import { getAgenda } from './agenda'
import { type Clock, nowClock } from './clock'
import { type Config, loadConfig } from './config'

export interface Notification {
  title: string
  body: string
}

/**
 * Decide which (if any) notification fires now. Meal windows fire near the top of the
 * hour; phase boundaries + the 10-min sleep warning fire within 15 min after the mark.
 * Later matches overwrite earlier ones (matches the bash assignment order).
 */
export function computeNotification(c: Clock, config: Config): Notification | null {
  let title = ''
  let body = ''

  // Meal-window openings — fire near the top of the hour only.
  if (c.min < 15) {
    if (c.hour === 8) {
      title = 'Śniadanie'
      body = 'Okno 08:00-10:00. Czas zjeść.'
    } else if (c.hour === 13) {
      title = 'Obiad'
      body = 'Okno 13:00-15:00. Czas zamówić / zjeść.'
    } else if (c.hour === 18) {
      title = 'Kolacja'
      body = 'Okno 18:00-20:00. Czas zjeść.'
    }
  }

  // fire_near: within 15 min AFTER the boundary (circular, handles midnight wrap).
  const fireNear = (boundary: string, t: string, b: string): void => {
    const bm = hmToMin(boundary)
    if ((c.minOfDay - bm + 1440) % 1440 < 15) {
      title = t
      body = b
    }
  }
  fireNear(config.wrapupStart, 'Zwijanie dnia', 'Pora kończyć — zacznij domykać pętle.')
  fireNear(config.eveningStart, 'Wieczorna rutyna', 'Koniec pracy. Czas się wyciszać.')

  // Sleep wall — fire in the 15 min leading up to sleep_start.
  const warnMin = (hmToMin(config.sleepStart) - 10 + 1440) % 1440
  if ((c.minOfDay - warnMin + 1440) % 1440 < 15) {
    title = 'Sen za 10 min'
    body = `${config.sleepStart} lights-out. Domykaj dzień, do łóżka.`
  }

  if (!title) return null
  return { title, body }
}

/** Per-boundary hourly dedup key — `YYYY-MM-DD-HH-<title>`. */
export function notifDedupKey(c: Clock, title: string): string {
  return `${c.ymd}-${String(c.hour).padStart(2, '0')}-${title}`
}

export function main(): void {
  const config = loadConfig()
  const c = nowClock()

  // Reminders off — this hook is pure nudging (meal windows + phase boundaries), so it has
  // nothing to contribute. The time-marker lives in the UserPromptSubmit hook, not here.
  if (!config.remindersEnabled) return

  // Bail silently if globally muted.
  const agenda = getAgenda(config.dopadonePath)
  if (agenda && agenda.muted != null) return

  const notif = computeNotification(c, config)
  if (!notif) return

  const stateFile = join(config.dataDir, 'health-rhythm-notif.txt')
  const nowKey = notifDedupKey(c, notif.title)
  let lastKey = ''
  if (existsSync(stateFile)) {
    try {
      lastKey = readFileSync(stateFile, 'utf8').trim()
    } catch {
      lastKey = ''
    }
  }
  if (nowKey === lastKey) return

  spawnSync(
    'osascript',
    [
      '-e',
      `display notification "${notif.body}" with title "🥗 ${notif.title}" sound name "Glass"`
    ],
    { stdio: 'ignore' }
  )
  mkdirSync(dirname(stateFile), { recursive: true })
  writeFileSync(stateFile, nowKey)
}
