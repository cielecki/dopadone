/**
 * Wall-clock helpers — local-time date/time + minutes-since-midnight, matching the
 * bash `date +%Y-%m-%d` / `date +%H:%M` / `hr_hm_to_min "$(date +%H:%M)"` usage.
 * Pure (takes a Date) so tests can pin the instant. This is the #292 "local-time
 * display" — TS does local natively.
 */
export interface Clock {
  ymd: string
  hm: string
  unixSec: number
  minOfDay: number
  hour: number
  min: number
}

function pad2(n: number): string {
  return String(n).padStart(2, '0')
}

export function clockFrom(d: Date): Clock {
  const hour = d.getHours()
  const min = d.getMinutes()
  return {
    ymd: `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`,
    hm: `${pad2(hour)}:${pad2(min)}`,
    unixSec: Math.floor(d.getTime() / 1000),
    minOfDay: hour * 60 + min,
    hour,
    min
  }
}

export function nowClock(): Clock {
  return clockFrom(new Date())
}
